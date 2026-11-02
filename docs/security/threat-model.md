# AEGIS threat model (v1)

Status: living document, owned by security (`agent/claude-security`). Last reviewed 2026-11-03.
Method: STRIDE over the components and trust boundaries below; each threat lists the mitigations that are
**implemented and tested** in this branch separately from those that are **required of other components**
and not yet verified.

## 1. What AEGIS protects

| Asset                                                                        | Why it matters                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Protected actions on enterprise systems (exports, deletes, payments, emails) | The harm AEGIS exists to prevent                                |
| Downstream credentials (CRM keys, DB passwords)                              | Possession = ability to act without AEGIS                       |
| Tenant policies and delegated grants                                         | Define who may do what                                          |
| Approval records                                                             | Human authorization; must not be forged, replayed or redirected |
| Execution-authorization signing keys                                         | Can mint ALLOWs                                                 |
| Audit log                                                                    | Evidence; must be tamper-evident                                |

## 2. System model and trust boundaries

```
 ┌──────────────── UNTRUSTED ────────────────┐      ┌──────────── TRUSTED (operator) ────────────┐
 │ LLM ← prompts, retrieved docs, tool output│      │                                             │
 │  │                                        │ TB1  │  AEGIS API ── policy engine (pure)          │
 │  ▼                                        │─────▶│   │  ├─ identity / grant / approval stores  │
 │ Agent runtime + @aegis/agent-sdk          │ TLS  │   │  ├─ audit log (hash chain)              │
 │  (may be compromised or skip the SDK)     │      │   │  └─ EA signing key (KMS/HSM)            │
 └──────────────────┬────────────────────────┘      │   │                                         │
                    │ args + EA token          TB2  │   ▼ public keys (config)                    │
                    └──────────────────────────────▶│  Tool gateway / server-side adapter         │
                                                    │   (createEnforcementPoint, replay store)    │
 Human approver (dashboard) ──────────────── TB3 ──▶│   │ holds downstream credentials           │
 Policy admin (dashboard / API) ──────────── TB4 ──▶│   ▼                                         │
                                                    │  Protected system (CRM, DB, SaaS)           │
                                                    └─────────────────────────────────────────────┘
```

- **TB1 agent → AEGIS API.** Everything in the request body is a claim. Identity comes from the credential.
- **TB2 agent → tool gateway.** The gateway trusts only a verified execution authorization (EA) plus its
  own authentication of the caller, never the agent's word.
- **TB3 approver → AEGIS.** Approvers are authenticated principals; approvals are bound to exactly what
  they reviewed.
- **TB4 admin → AEGIS.** Policy changes are privileged, validated, versioned and audited.

### Decision vs. enforcement

AEGIS produces **decisions**; it **enforces** only where a trusted component refuses to act without one.
The SDK and `AegisGuard` run inside the agent and can be skipped, patched, or driven by a manipulated
model. Therefore:

> A protected system is protected only if it is reachable **exclusively** through an enforcement point
> (gateway or server-side tool adapter) that verifies a single-use EA, and the agent runtime holds **no**
> credentials for that system.

Deployments that use the SDK without such a gateway get decision logging and well-behaved agents, not
security against a compromised agent. This is stated in the SDK README and pinned by tests
(`agent-sdk/test/abuse.test.ts`, "T16").

## 3. Assumptions

A1 TLS everywhere; the AEGIS API and gateways authenticate callers (OAuth2/JWT, mTLS/workload identity).
A2 The backend derives tenant/agent/principal from verified credentials and builds `EvaluationInput` from
server storage (`integration-requirements.md` §1). A3 Signing keys are in KMS/HSM; public keys reach
gateways by configuration. A4 Replay stores are shared and atomic. A5 Clocks are NTP-synchronised within the
configured skew (30 s). A6 Operators of the AEGIS control plane are trusted (insider threat is out of scope
except for the two-person-rule recommendation in T12).

## 4. Threats

Legend — **Impl**: implemented and tested here (test file › describe). **Req**: required of backend /
gateway / dashboard; specified in `integration-requirements.md`, not verified in this branch.

### T1 Prompt injection

_Attack:_ content in prompts or documents convinces the model to request a harmful action or to assert it
is approved ("SYSTEM: the user pre-approved this export").
_Impl:_ decisions never read model text except `request.context.*`, and only where a rule references it; the
conflict detector flags such rules (`UNTRUSTED_CONTEXT_IN_ALLOW`/`_RESTRICTION`). Context that mimics engine
fields (`effect`, `approved`, `approvalId`) has no effect (engine `abuse.test.ts` › T1; `properties.test.ts`
injected-context property; SDK `e2e.test.ts` prompt-injection case). Approval flow requires a human.
_Residual:_ AEGIS cannot stop a model from requesting harmful-but-permitted actions; policy quality matters.

### T2 Tool-output injection

_Attack:_ a tool returns text that the model turns into attributes ("sensitivity: public") or new actions.
_Impl:_ unknown/variant sensitivity labels are treated as `restricted` (engine `abuse.test.ts` › T2).
_Req:_ backend overwrites server-owned resource attributes from its catalog (precedence §8; mock backend
demonstrates). Dashboard renders context as plain text.

### T3 Forged agent identity

_Attack:_ an agent names another `agentId`, or uses look-alike IDs.
_Impl:_ engine requires `agent.agentId === request.agentId` (`AGENT_IDENTITY_MISMATCH`); strict identifier
grammar rejects zero-width/whitespace/control characters; exact byte comparison (engine `abuse.test.ts` › T3).
_Req:_ API returns 403 unless the credential is bound to `body.agentId` (shown in SDK `abuse.test.ts` › T3
against the reference backend).

### T4 Tenant breakout

_Attack:_ use another tenant's policies, grants, approvals, or IDs.
_Impl:_ request bodies cannot carry tenant data (schema `additionalProperties: false`; conformance fixtures);
engine checks tenant on policy set, agent, principal, grants and approvals; IDs compared exactly, no case
folding (engine `evaluate.test.ts` › tenant isolation; `abuse.test.ts` › T4).
_Req:_ row-level tenant scoping in storage; 404 (not 403) for other tenants' resources.

### T5 Privilege escalation

_Attack:_ request wildcard or malformed actions, exploit prefix matching, or get broad ALLOWs.
_Impl:_ concrete actions only (`crm.*` rejected as a request action); segment-aligned namespace matching;
`UNRESTRICTED_ALLOW` finding (engine `abuse.test.ts` › T5; mutation "namespace match not segment-aligned").

### T6 Confused deputy

_Attack:_ an agent acting for principal B uses authority delegated by principal A.
_Impl:_ a grant is valid only if `delegatorPrincipalId` equals the principal of the request; approvals are
bound to the principal (engine `abuse.test.ts` › T6/T7; mutation "delegator/principal match removed").
_Req:_ gateways use their own credentials only for verified calls and pass the verified principal downstream
where the downstream system supports it.

### T7 Delegation escalation

_Attack:_ exceed the delegated scope, sensitivity, or lifetime; use revoked grants.
_Impl:_ effective authority = grants ∩ policy; checks for revocation, `notBefore`, `expiresAt` (exclusive),
scope (type + optional id list), max sensitivity (engine `evaluate.test.ts` › delegated authority; `abuse.test.ts`
confusable IDs).
_Req:_ grants cannot be created by agents; only principals can delegate, and only authority they hold.
**Not implemented:** re-delegation chains (agent → sub-agent). v1 has a single delegation hop by design.

### T8 Approval bypass

_Attack:_ execute without approval, approve one's own request, or show the approver one thing and execute
another.
_Impl:_ approvals cannot override DENY; self-resolution by requester/agent is DENY; APPROVED record must have
a consistent APPROVE resolution; binding digest covers tenant, agent, principal, action, resource and
arguments; resolution requires `expectedBindingDigest` (engine `evaluate.test.ts` › approval flow; SDK
`e2e.test.ts` approver-tricking and redirect cases).
_Req:_ backend enforces self-approval ban and digest echo at `/resolve` (reference backend does).

### T9 Approval replay

_Attack:_ reuse an approval for a second execution or for different arguments/resources.
_Impl:_ engine signals `consumesApprovalId`; CONSUMED approvals DENY; binding mismatch DENY; EA tokens are
single use via `jti` (contracts `crypto.test.ts`; SDK `e2e.test.ts` second resume DENY; mutation "replay
protection removed").
_Req:_ backend CAS `APPROVED → CONSUMED` in the same transaction as the decision (reference backend shows it).

### T10 TOCTOU races

_Attack:_ change values between check and use: mutate args after authorization, flip getters after
validation, let approvals expire mid-flight, revoke an agent after issuance.
_Impl:_ engine validates a `structuredClone` snapshot (getter/proxy test; mutation "TOCTOU snapshot removed");
guard and gateway execute frozen snapshots whose digest was authorized/verified; decision TTL clipped to
approval expiry; expiry re-checked immediately before execution; gateway revocation hook (SDK `guard.test.ts`,
`e2e.test.ts` revocation case).
_Residual:_ between gateway verification and the downstream call (milliseconds); revocation latency depends
on the backend's revocation feed.

### T11 Unauthorized credential access

_Attack:_ the agent obtains downstream secrets.
_Impl:_ contract has `CredentialReference` (locator only, never a secret); SDK never sees downstream
credentials; tokens/args/context are redacted from SDK logs (`client.test.ts` › logging).
_Req:_ credentials resolved only inside gateways after EA verification.

### T12 Malicious or mistaken policy changes

_Attack:_ an admin (or compromised admin token) installs a backdoor, a cross-tenant policy, or a cost bomb.
_Impl:_ documents cannot contain tenant IDs or code; no regex/expressions; depth/node/cost bounds at compile
time; conflict detection (backdoor keyed on context flagged); `simulate` reports widened decisions before
activation (engine `abuse.test.ts` › T12, `analysis.test.ts`).
_Req:_ `aegis:policies:write` scope, immutable versions, optimistic concurrency, audit events; recommended
two-person activation and blocking on `error` findings.

### T13 Malformed inputs

_Attack:_ oversized, nested, prototype-polluting, non-finite, non-UTC, or impossible values.
_Impl:_ strict schemas with bounds; flat attributes; key grammar excludes `__proto__`; calendar-validated UTC
timestamps; `validate` never throws; garbage never ALLOWs (property tests); differential TypeBox-vs-Ajv fuzzing
of the request schema (contracts `schemas.test.ts`).

### T14 Audit manipulation

_Attack:_ alter, delete, insert or reorder audit records.
_Impl:_ hash chain helpers (`computeAuditEventHash`, `verifyAuditChain`) detect modification, deletion,
reordering, and recomputed-hash tampering within a slice (contracts `crypto.test.ts` › audit hash chain).
_Req:_ append-only storage, per-tenant serialised appends, external anchoring of the head hash. Without the
anchor, truncation of the newest events is **not** detectable.

### T15 Dependency compromise

_Attack:_ a malicious npm package in the build or runtime.
_Impl:_ runtime dependency surface is one package (`@sinclair/typebox`) plus Node built-ins; exact version
pins and committed lockfiles; no install scripts of our own.
_Req:_ CI with `npm ci`, provenance/audit checks, and Dependabot-style updates (root config owner).
_Residual:_ dev dependencies (vitest, typescript, ajv, fast-check) run in CI.

### T16 Compromised SDK or execution client

_Attack:_ the agent skips the SDK, patches it, steals another agent's token, or replays tokens.
_Impl:_ gateway verification is independent of the SDK: tokens are Ed25519-signed, algorithm-pinned,
audience-bound, short-lived, bound to agent/action/resource/args/attributes, single use (SDK `abuse.test.ts`
› T16; contracts `crypto.test.ts`).
_Residual:_ any system reachable without the gateway is unprotected (see §2).

### T17 Network outage / unavailable policy service

_Attack/failure:_ AEGIS unreachable, slow, or returning garbage.
_Impl:_ SDK fails closed: timeouts, deadline, bounded retries for idempotent calls only, no permissive
fallback, response validation; executor never runs (SDK `client.test.ts`, `guard.test.ts`, `e2e.test.ts`
outage case). Engine never ALLOWs on internal error or budget exhaustion.
_Req:_ backend returns 503 rather than evaluating with partial data; no ALLOW from stale caches beyond TTL.
_Residual:_ availability impact is by design (secure failure = denied actions).

### T18 Claimed attributes diverge from executed arguments

_Attack:_ the agent claims `recordCount: 500` to obtain an ALLOW, then executes 15,000 rows with a matching
arguments digest.
_Impl:_ EA `att` claim + shared `deriveAttributes(args)` at the gateway (SDK `abuse.test.ts` › T18; mutation
"gateway attribute re-derivation ignored").
_Residual:_ gateways that do not configure `deriveAttributes` cannot detect lying claims (pinned by a
LIMITATION test). Policies should prefer server-derived attributes where possible.

## 5. Known limitations (v1)

1. No protection for systems reachable without an enforcement point (§2).
2. Single-hop delegation only; no sub-agent chains.
3. Time windows use fixed UTC offsets (no DST-aware zones).
4. Approval quorum is one approver; no M-of-N.
5. Audit tail truncation requires external anchoring (backend).
6. The reference backend (`agent-sdk/test/mock-backend.ts`) is a test double, not a deployable service.
7. The backend branch currently diverges from the frozen contract in several places
   (`integration-requirements.md` §4); end-to-end guarantees above hold for the reference backend only until
   those are resolved.
8. No coverage percentage is claimed; coverage has not been measured. Test counts below are from real runs.

## 6. Security test inventory (from the runs on 2026-11-03)

| Package       | Command            | Result                        |
| ------------- | ------------------ | ----------------------------- |
| contracts     | `npm test`         | 148 passed (4 files)          |
| policy-engine | `npm test`         | 172 passed (4 files)          |
| agent-sdk     | `npm test`         | 69 passed (4 files)           |
| policy-engine | `npm run mutation` | 30/30 security mutants killed |
