import { canonicalJson, type Condition, type PolicyRule } from '@aegis/contracts';
import { collectRefs } from './condition.js';
import { actionPatternCovers, actionPatternsOverlap, resourceTypePatternCovers } from './match.js';
import type { CompiledPolicySet, CompiledRule } from './types.js';

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface ConflictFinding {
  readonly severity: FindingSeverity;
  readonly code:
    | 'SHADOWED_ALLOW'
    | 'ALLOW_ALWAYS_NEEDS_APPROVAL'
    | 'OVERLAPPING_ALLOW_DENY'
    | 'UNTRUSTED_CONTEXT_IN_ALLOW'
    | 'UNTRUSTED_CONTEXT_IN_RESTRICTION'
    | 'UNRESTRICTED_ALLOW'
    | 'ACTION_NOT_IN_CATALOG'
    | 'DUPLICATE_RULE'
    | 'CONSTANT_CONDITION';
  readonly message: string;
  readonly rules: readonly string[];
}

const isUnconditional = (r: PolicyRule): boolean => !r.when && !r.timeWindows && !r.sensitivity;

/** Does rule `a` match (at least) every action/resource-type combination rule `b` matches? */
function scopeCovers(a: PolicyRule, b: PolicyRule): boolean {
  return (
    b.actions.every((pb) => a.actions.some((pa) => actionPatternCovers(pa, pb))) &&
    b.resourceTypes.every((tb) => a.resourceTypes.some((ta) => resourceTypePatternCovers(ta, tb)))
  );
}

function scopeOverlaps(a: PolicyRule, b: PolicyRule): boolean {
  return (
    a.actions.some((pa) => b.actions.some((pb) => actionPatternsOverlap(pa, pb))) &&
    a.resourceTypes.some((ta) => b.resourceTypes.some((tb) => ta === '*' || tb === '*' || ta === tb))
  );
}

function hasConstantComparison(c: Condition): boolean {
  if ('all' in c) return c.all.some(hasConstantComparison);
  if ('any' in c) return c.any.some(hasConstantComparison);
  if ('not' in c) return hasConstantComparison(c.not);
  if ('exists' in c || 'startsWith' in c || 'endsWith' in c) return false;
  const pair = Object.values(c)[0] as Array<Record<string, unknown>>;
  return pair.every((op) => !('ref' in op));
}

/**
 * Static analysis of a compiled policy set. Findings are advisory except `error`, which a backend should
 * treat as blocking activation. Output order is deterministic.
 */
export function detectConflicts(set: CompiledPolicySet): ConflictFinding[] {
  const findings: ConflictFinding[] = [];
  const rules = set.rules;
  const byEffect = (e: PolicyRule['effect']): CompiledRule[] => rules.filter((r) => r.rule.effect === e);
  const allows = byEffect('ALLOW');
  const denies = byEffect('DENY');
  const approvals = byEffect('REQUIRE_APPROVAL');

  for (const a of allows) {
    const shadow = denies.find((d) => isUnconditional(d.rule) && scopeCovers(d.rule, a.rule));
    if (shadow) {
      findings.push({
        severity: 'warning',
        code: 'SHADOWED_ALLOW',
        message: `ALLOW ${a.key} can never take effect: unconditional DENY ${shadow.key} covers it`,
        rules: [a.key, shadow.key],
      });
      continue;
    }
    const gate = approvals.find((r) => isUnconditional(r.rule) && scopeCovers(r.rule, a.rule));
    if (gate) {
      findings.push({
        severity: 'info',
        code: 'ALLOW_ALWAYS_NEEDS_APPROVAL',
        message: `ALLOW ${a.key} always requires approval because of ${gate.key}`,
        rules: [a.key, gate.key],
      });
    }
    for (const d of denies) {
      if (!isUnconditional(d.rule) && scopeOverlaps(a.rule, d.rule)) {
        findings.push({
          severity: 'info',
          code: 'OVERLAPPING_ALLOW_DENY',
          message: `ALLOW ${a.key} and conditional DENY ${d.key} overlap; DENY wins whenever both apply`,
          rules: [a.key, d.key],
        });
      }
    }
    if (a.rule.actions.includes('*') && a.rule.resourceTypes.includes('*') && !a.rule.when) {
      findings.push({
        severity: 'warning',
        code: 'UNRESTRICTED_ALLOW',
        message: `ALLOW ${a.key} permits every action on every resource type without conditions`,
        rules: [a.key],
      });
    }
  }

  for (const r of rules) {
    const refs = r.rule.when ? collectRefs(r.rule.when) : [];
    if (refs.some((x) => x.startsWith('request.context.'))) {
      findings.push(
        r.rule.effect === 'ALLOW'
          ? {
              severity: 'warning',
              code: 'UNTRUSTED_CONTEXT_IN_ALLOW',
              message: `ALLOW ${r.key} depends on caller-supplied request.context, which the agent (or a prompt injection) controls`,
              rules: [r.key],
            }
          : {
              severity: 'warning',
              code: 'UNTRUSTED_CONTEXT_IN_RESTRICTION',
              message: `${r.rule.effect} ${r.key} depends on caller-supplied request.context; a caller may be able to evade it`,
              rules: [r.key],
            },
      );
    }
    if (r.rule.when && hasConstantComparison(r.rule.when)) {
      findings.push({
        severity: 'warning',
        code: 'CONSTANT_CONDITION',
        message: `${r.key} compares two literals; the comparison is constant`,
        rules: [r.key],
      });
    }
    if (set.actionCatalog) {
      for (const p of r.rule.actions) {
        if (p !== '*' && !p.endsWith('.*') && !set.actionCatalog.has(p)) {
          findings.push({
            severity: 'error',
            code: 'ACTION_NOT_IN_CATALOG',
            message: `${r.key} names action ${p}, which is not in the action catalog and can never match`,
            rules: [r.key],
          });
        }
      }
    }
  }

  const seen = new Map<string, string>();
  for (const r of rules) {
    const { id: _id, description: _d, ...shape } = r.rule;
    const fingerprint = canonicalJson(shape);
    const first = seen.get(fingerprint);
    if (first) {
      findings.push({ severity: 'info', code: 'DUPLICATE_RULE', message: `${r.key} duplicates ${first}`, rules: [first, r.key] });
    } else {
      seen.set(fingerprint, r.key);
    }
  }
  return findings;
}
