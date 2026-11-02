// Security mutation smoke test: applies one hand-picked mutation at a time to a security-critical check,
// runs the owning package's test suite, and expects it to FAIL ("killed"). A surviving mutant means a
// security property is not actually pinned by tests. Files are always restored.
//
// Usage (from packages/policy-engine): node scripts/mutation-smoke.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packages = fileURLToPath(new URL('../../', import.meta.url));

const MUTANTS = [
  // policy-engine: precedence, fail-safe logic, isolation, approvals, delegation
  ['policy-engine', 'src/evaluate.ts', 'if (denies.length > 0) {', 'if (false) {', 'explicit DENY ignored'],
  ['policy-engine', 'src/evaluate.ts', "return rule.effect === 'ALLOW' ? 'NO_MATCH' : 'INDETERMINATE';", "return 'NO_MATCH';", 'UNKNOWN no longer triggers restrictive rules'],
  ['policy-engine', 'src/evaluate.ts', "return rule.effect === 'ALLOW' ? 'NO_MATCH' : 'INDETERMINATE';", "return 'INDETERMINATE';", 'UNKNOWN satisfies ALLOW rules'],
  ['policy-engine', 'src/evaluate.ts', 'if (compiled.tenantId !== inp.tenantId) {', 'if (false) {', 'policy tenant binding removed'],
  ['policy-engine', 'src/evaluate.ts', "if (apr.bindingDigest !== bindingDigest) return fail('APPROVAL_BINDING_MISMATCH');", '', 'approval binding check removed'],
  ['policy-engine', 'src/evaluate.ts', "if (apr.status === 'CONSUMED') return fail('APPROVAL_ALREADY_CONSUMED');", '', 'approval replay check removed'],
  ['policy-engine', 'src/evaluate.ts', "      return fail('APPROVAL_SELF_RESOLVED');", '      void 0;', 'self-approval check removed'],
  ['policy-engine', 'src/evaluate.ts', "if (apr.status === 'EXPIRED' || nowMs >= expiresMs) {", "if (apr.status === 'EXPIRED') {", 'approval time expiry ignored'],
  ['policy-engine', 'src/evaluate.ts', "if (g.revokedAt !== null) return 'DELEGATION_REVOKED';", '', 'grant revocation ignored'],
  ['policy-engine', 'src/evaluate.ts', "if (nowMs >= parseTimestamp(g.expiresAt)) return 'DELEGATION_EXPIRED';", "if (nowMs > parseTimestamp(g.expiresAt)) return 'DELEGATION_EXPIRED';", 'grant expiry off-by-one'],
  ['policy-engine', 'src/evaluate.ts', 'g.delegatorPrincipalId === inp.principal.principalId', 'true', 'delegator/principal match removed (confused deputy)'],
  ['policy-engine', 'src/evaluate.ts', "if (inp.agent.status !== 'ACTIVE') return 'AGENT_INACTIVE';", '', 'suspended agents allowed'],
  ['policy-engine', 'src/evaluate.ts', 'if (compiled.actionCatalog && !compiled.actionCatalog.has(action)) {', 'if (false) {', 'action catalog ignored'],
  ['policy-engine', 'src/evaluate.ts', '      snapshot = structuredClone(input);', '      snapshot = input;', 'TOCTOU snapshot removed'],
  ['policy-engine', 'src/match.ts', "if (pattern.endsWith('.*')) return action.startsWith(pattern.slice(0, -1));", "if (pattern.endsWith('.*')) return action.startsWith(pattern.slice(0, -2));", 'namespace match not segment-aligned'],
  ['policy-engine', 'src/match.ts', 'return RESTRICTED;', 'return 0;', 'unknown sensitivity treated as public'],
  ['policy-engine', 'src/match.ts', 'minutes < hhmmToMinutes(window.end)', 'minutes <= hhmmToMinutes(window.end)', 'time window end inclusive'],
  ['policy-engine', 'src/condition.ts', 'return Object.hasOwn(map, key) ? (map[key] as AttributeValue) : MISSING;', 'return key in map ? (map[key] as AttributeValue) : MISSING;', 'prototype members readable as attributes'],
  ['policy-engine', 'src/compile.ts', 'if (cost > MAX_STATIC_COST) {', 'if (false) {', 'static cost bound removed'],
  // contracts: execution authorization verification
  ['contracts', 'src/crypto/execution-authorization.ts', "['args', claims.args === e.argumentsDigest],", "['args', true],", 'arguments binding not checked'],
  ['contracts', 'src/crypto/execution-authorization.ts', "if (!(await options.replayStore.consume(claims.jti, claims.exp + skew, now))) return fail('REPLAYED');", '', 'replay protection removed'],
  ['contracts', 'src/crypto/execution-authorization.ts', "if (now - skew >= claims.exp) return fail('EXPIRED');", '', 'expiry not enforced'],
  ['contracts', 'src/crypto/execution-authorization.ts', "if (!verify(null, Buffer.from(`${h}.${p}`, 'ascii'), key, signature)) return fail('BAD_SIGNATURE');", '', 'signature not verified'],
  ['contracts', 'src/crypto/execution-authorization.ts', "if (claims.aud !== e.audience) return fail('AUDIENCE_MISMATCH');", '', 'audience not checked'],
  // agent-sdk: client and guard
  ['agent-sdk', 'src/guard.ts', "if (decision.effect === 'DENY') throw new AegisDeniedError(decision, null);", '', 'guard DENY branch removed'],
  ['agent-sdk', 'src/guard.ts', 'if (this.requireEA && ea === null) {', 'if (false) {', 'execution authorization not required'],
  ['agent-sdk', 'src/guard.ts', 'if (limits.some((t) => !Number.isFinite(t) || this.now() >= t)) {', 'if (false) {', 'expiry not checked before execution'],
  ['agent-sdk', 'src/client.ts', 'const retryable = transient && idempotent;', 'const retryable = true;', 'non-transient errors retried'],
  ['agent-sdk', 'src/client.ts', "redirect: 'error'", "redirect: 'follow'", 'redirects followed with bearer token'],
  ['agent-sdk', 'src/enforcement.ts', 'if (call.deriveAttributes) attributesDigest = computeAttributesDigest(call.deriveAttributes(snapshot));', '', 'gateway attribute re-derivation ignored'],
];

const vitest = (pkg) => `${packages}${pkg}/node_modules/vitest/vitest.mjs`;
let survivors = 0;
const results = [];

for (const [pkg, rel, find, replace, label] of MUTANTS) {
  const file = `${packages}${pkg}/${rel}`;
  const original = readFileSync(file, 'utf8');
  const count = original.split(find).length - 1;
  if (count !== 1) {
    results.push(['INVALID', label, `${pkg}/${rel}: pattern found ${count} times`]);
    survivors++;
    continue;
  }
  const restore = () => writeFileSync(file, original);
  process.once('SIGINT', restore);
  try {
    writeFileSync(file, original.replace(find, replace));
    const run = spawnSync(process.execPath, [vitest(pkg), 'run', '--reporter=dot'], { cwd: `${packages}${pkg}`, encoding: 'utf8' });
    const killed = run.status !== 0;
    if (!killed) survivors++;
    results.push([killed ? 'KILLED' : 'SURVIVED', label, `${pkg}/${rel}`]);
  } finally {
    restore();
    process.removeListener('SIGINT', restore);
  }
  console.log(`${results.at(-1)[0].padEnd(8)} ${label}`);
}

console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} mutants killed`);
process.exit(survivors === 0 ? 0 : 1);
