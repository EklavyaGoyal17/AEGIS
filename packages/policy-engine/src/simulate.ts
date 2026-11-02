import type { Effect } from '@aegis/contracts';
import { compilePolicySet } from './compile.js';
import { evaluate } from './evaluate.js';
import type { CompiledPolicySet, EngineDecision, EvaluateOptions, PolicyIssue, PolicySet } from './types.js';

export interface SimulationCase {
  readonly name: string;
  readonly input: unknown;
  /** Optional assertion: the effect the policy author expects under the candidate (or current) policy. */
  readonly expectEffect?: Effect;
}

export interface SimulationCaseResult {
  readonly name: string;
  readonly current: EngineDecision;
  readonly candidate: EngineDecision | null;
  readonly changed: boolean;
  /** True when the candidate grants more than the current policy (DENY→ALLOW, DENY→REQUIRE_APPROVAL, REQUIRE_APPROVAL→ALLOW). */
  readonly widened: boolean;
  readonly expectationMet: boolean | null;
}

export interface SimulationReport {
  readonly ok: boolean;
  readonly candidateIssues: readonly PolicyIssue[];
  readonly results: readonly SimulationCaseResult[];
  readonly summary: {
    readonly total: number;
    readonly changed: number;
    readonly widened: number;
    readonly failedExpectations: number;
    readonly transitions: Readonly<Record<string, number>>;
  };
}

const RANK: Record<Effect, number> = { DENY: 0, REQUIRE_APPROVAL: 1, ALLOW: 2 };

/**
 * Dry-run: evaluates cases against the current policy set and (optionally) a candidate, without any side
 * effects. Use before activating a policy version to see exactly which decisions would change.
 */
export function simulate(
  current: CompiledPolicySet | PolicySet | unknown,
  candidate: CompiledPolicySet | PolicySet | unknown | null,
  cases: readonly SimulationCase[],
  options: EvaluateOptions = {},
): SimulationReport {
  let candidateIssues: readonly PolicyIssue[] = [];
  let compiledCandidate: CompiledPolicySet | null = null;
  if (candidate !== null) {
    const c = compilePolicySet(candidate);
    if (c.ok) compiledCandidate = c;
    else candidateIssues = c.issues;
  }
  const compiledCurrent = compilePolicySet(current);
  const currentSet = compiledCurrent.ok ? compiledCurrent : current;

  const transitions: Record<string, number> = {};
  const results = cases.map((c): SimulationCaseResult => {
    const cur = evaluate(currentSet, c.input, options);
    const cand = candidate === null ? null : evaluate(compiledCandidate ?? candidate, c.input, options);
    const changed = cand !== null && (cand.effect !== cur.effect || cand.reasonCodes.join() !== cur.reasonCodes.join());
    const widened = cand !== null && RANK[cand.effect] > RANK[cur.effect];
    if (cand !== null && cand.effect !== cur.effect) {
      const k = `${cur.effect}->${cand.effect}`;
      transitions[k] = (transitions[k] ?? 0) + 1;
    }
    const observed = (cand ?? cur).effect;
    return {
      name: c.name,
      current: cur,
      candidate: cand,
      changed,
      widened,
      expectationMet: c.expectEffect === undefined ? null : c.expectEffect === observed,
    };
  });

  const failedExpectations = results.filter((r) => r.expectationMet === false).length;
  return {
    ok: candidateIssues.length === 0 && failedExpectations === 0,
    candidateIssues,
    results,
    summary: {
      total: results.length,
      changed: results.filter((r) => r.changed).length,
      widened: results.filter((r) => r.widened).length,
      failedExpectations,
      transitions,
    },
  };
}
