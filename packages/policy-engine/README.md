# @aegis/policy-engine

Deterministic, side-effect-free, fail-closed authorization engine for AEGIS. Normative semantics:
[`docs/security/policy-precedence.md`](../../docs/security/policy-precedence.md).

```ts
import { compilePolicySet, evaluate, detectConflicts, simulate } from '@aegis/policy-engine';

const compiled = compilePolicySet(policySet);          // validate once per policy revision
if (!compiled.ok) throw new PolicyInvalid(compiled.issues);

const decision = evaluate(compiled, evaluationInput);  // never throws; never ALLOWs on error
// decision.effect: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL'
// decision.reasonCodes, decision.policyVersion, decision.decisionTtlSeconds
// decision.approval          -> { ttlSeconds, bindingDigest } when REQUIRE_APPROVAL
// decision.consumesApprovalId -> server MUST CAS APPROVED→CONSUMED atomically with the decision
// decision.trace             -> identifiers and codes only (no request values)
```

## Guarantees (each covered by tests)

| Property | Where tested |
|---|---|
| Default DENY; explicit DENY > REQUIRE_APPROVAL > ALLOW; order-independent | `evaluate.test.ts` precedence, `properties.test.ts` |
| Approvals bound to tenant/agent/principal/action/resource/arguments; single use; no self-approval; cannot override DENY | `evaluate.test.ts` approval flow |
| Tenant isolation of policies, agents, principals, grants, approvals | `evaluate.test.ts` tenant isolation |
| Delegation: expiry, not-before, revocation, scope, sensitivity, delegator match | `evaluate.test.ts` delegated authority |
| Three-valued conditions: missing/mistyped attributes never satisfy ALLOW, always trigger DENY/approval | `evaluate.test.ts` three-valued |
| Caller context cannot change a decision unless a rule references it | `properties.test.ts` |
| Strict input validation on a snapshot (no TOCTOU via getters/proxies) | `evaluate.test.ts` malformed input |
| Bounded work: static cost bound at compile time, runtime step budget | `evaluate.test.ts` resource limits |
| Garbage input / policy never yields ALLOW | `properties.test.ts` |
| Determinism (deep-equal output incl. trace) | `properties.test.ts`, `evaluate.test.ts` traces |

The DSL is a JSON AST (`PolicyDocument` in `@aegis/contracts`). There is no expression parser, no regular
expressions, no dynamic code, and no clock or network access in the engine.

## Tools

- `detectConflicts(compiled)` — shadowed ALLOWs, ALLOWs that always need approval, overlapping ALLOW/DENY,
  rules depending on untrusted `request.context`, unrestricted ALLOW, constant conditions, duplicate rules,
  actions missing from the catalog (`error`).
- `simulate(current, candidate, cases)` — dry run; reports changed and **widened** decisions
  (DENY→ALLOW, DENY→REQUIRE_APPROVAL, REQUIRE_APPROVAL→ALLOW) and failed expectations.
- `createBackendPolicyEngine({ loadContext })` — adapter that implements the backend's `PolicyEngine` seam
  (`services/api/src/domain.ts` on `agent/codex-backend`) structurally. I/O happens only in `loadContext`.

## Fixtures for backend integration

`fixtures/engine-cases.json`: a policy set plus 14 `EvaluationInput` cases with the exact expected effect and
reason codes. The backend should replay them through its HTTP API (after mapping server-side records) and
directly through the engine.

## Commands

```bash
npm install
npm run typecheck
npm test
npm run build   # requires ../contracts to be built first (npm --prefix ../contracts run build)
```
