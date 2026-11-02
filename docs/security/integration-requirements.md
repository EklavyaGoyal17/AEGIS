# AEGIS integration requirements (security-owned)

Audience: Codex (backend / gateway / persistence), Antigravity (dashboard / demo / E2E).
Owner: `agent/claude-security`. Changes to the frozen contract go through "Proposed contract revisions" below.

## 0. Repository layout and root configuration

Status on `integration/aegis-v1`: done. A single root npm workspace (Node 24, npm 11) contains
`packages/{contracts,policy-engine,agent-sdk}`, `services/*` and `apps/*`. `npm run build` builds
contracts → policy-engine → agent-sdk → services. CI (`.github/workflows/ci.yml`) runs every package's tests,
`check:generated`, the mutation smoke test, DB integration tests, the Compose stack and browser E2E.
`.gitattributes` normalises all text to LF.

## 1. Backend (Codex) — MUST

### 1.1 Authentication and identity derivation

- Derive `tenantId`, the calling agent or principal, and scopes **only** from the verified bearer token.
- `POST /v1/decisions/evaluate`: the token must authenticate the agent named in `body.agentId`; otherwise 403
  FORBIDDEN. Never fall back to "trust the body".
- Required scopes per route are in `x-aegis-required-scopes` in `openapi/aegis-v1.yaml`.
- Resources of another tenant must be indistinguishable from non-existent ones (404, never 403).

### 1.2 Building the engine input

- Load `AgentIdentity`, `Principal` (the principal the agent acts for — the delegator), all
  `DelegatedAuthority` grants for (tenant, agent), and the tenant's active `PolicySet` from server storage.
- Overwrite server-owned resource attributes (`sensitivity`, `classification`, `ownerTenantId`, `owner`,
  `dataResidency`) from the resource catalog; delete them when the catalog has no value.
- Put server facts in `environment` (e.g. `networkZone`, `mfaAgeSeconds`, `businessHours`). Never copy
  `request.context` into `environment`.
- Pass `now` from the server clock (UTC). Pass `approval` only if found by `request.approvalId` **within the
  tenant**.
- Call `evaluate(compiledPolicySet, input)` from `@aegis/policy-engine`. Treat any thrown error, timeout or
  non-ALLOW as "do not execute".

### 1.3 Decisions, idempotency and expiry

- `requestId` is an idempotency key scoped to (tenant, agent): replay the stored response for an identical body;
  409 IDEMPOTENCY_CONFLICT for a different body (compare `sha256Digest(body)`).
- `expiresAt` = `now + decisionTtlSeconds` from the engine output (REQUIRE_APPROVAL: approval expiry).
- Persist a `Decision` record and a `DECISION_EVALUATED` audit event for every evaluation, including DENYs and
  validation failures that reached the engine.

### 1.4 Approvals

- On REQUIRE_APPROVAL: create `ApprovalRequest` with `bindingDigest = computeApprovalBindingDigest(...)` (from
  `@aegis/contracts/crypto`), `policyVersion`, `expiresAt = now + approvalTtlSeconds`.
- `POST /v1/approvals/{id}/resolve`: require `aegis:approvals:resolve`; reject (409 SELF_APPROVAL_FORBIDDEN)
  if the resolver is the requesting principal or the agent; reject (409 APPROVAL_BINDING_MISMATCH) unless
  `expectedBindingDigest` equals the stored digest; transition only from PENDING (compare-and-set, else 409
  APPROVAL_NOT_PENDING); write `APPROVAL_RESOLVED` audit event.
- When the engine returns ALLOW with `consumesApprovalId`, atomically CAS `APPROVED → CONSUMED` in the same
  transaction as the decision. If the CAS fails return DENY `APPROVAL_ALREADY_CONSUMED`.
- A background job marks PENDING approvals past `expiresAt` as EXPIRED (the engine also checks `now`).

### 1.5 Execution authorization (for protected tools)

- For actions configured as protected, require `argumentsDigest` in the evaluate request (400 otherwise).
- On ALLOW, mint with `mintExecutionAuthorization` (Ed25519 key from KMS/HSM, `kid` rotation, lifetime ≤ 60 s
  recommended, ≤ 300 s hard cap) and return it as `executionAuthorization`. Set
  `att = computeAttributesDigest(request.resource.attributes)` over the attributes **as received** (before the
  server-owned merge).
- The gateway / tool adapter in front of the protected system MUST call `verifyExecutionAuthorization` with:
  its own audience id, the tenant from its own auth context, `computeArgumentsDigest(actualArguments)`,
  a **shared atomic** replay store (Redis `SET NX EX` or a unique DB row), a revocation hook (agent
  suspended, grant revoked), and — for every tool whose policy reads caller-claimed attributes — a
  `deriveAttributes(args)` function shared with the agent-side tool definition. Only then may it resolve the
  `CredentialReference` and call the downstream system.
- See `docs/security/execution-authorization.md`.

### 1.6 Policies

- `POST /v1/policies` requires `aegis:policies:write`. Validate with `compilePolicySet` before storing; reject
  with 400 POLICY_INVALID including the compiler's issues. Tenant comes from the token, never the document.
- Versions are immutable; activation is a separate state change recorded as `POLICY_ACTIVATED`.
- Run `detectConflicts` and return/store its findings; consider blocking activation on `error` findings.
- Store `documentDigest = sha256Digest(document)` and verify it when loading.
- Recommended: two-person rule for activation (proposer ≠ activator).

### 1.7 Audit

- Append-only per tenant, gap-free `sequence`, `previousEventHash` chain, `eventHash =
computeAuditEventHash(event)`; serialise appends per tenant (single writer or `SELECT … FOR UPDATE`).
- Periodically export the latest `eventHash` to an external anchor (WORM bucket / transparency log) so tail
  truncation is detectable. `verifyAuditChain` validates slices.
- `payloadDigest` = `sha256Digest(<event payload>)`; never store secrets or raw tool arguments in audit.

### 1.8 Errors and availability

- Use the `ErrorEnvelope` for every non-2xx; `retryable` true only for RATE_LIMITED / UNAVAILABLE.
- If the policy store, grant store or approval store is unavailable: 503 UNAVAILABLE. Never ALLOW from cache
  beyond the decision TTL, and never evaluate against an empty policy set as a fallback.

## 2. Dashboard (Antigravity) — MUST

- Display names are labels only; key all UI state and API calls on IDs.
- Approval UI must show: agent, requesting principal, action, resource type/id, resource attributes, arguments
  digest, policy version, matched rules, expiry; and must send `expectedBindingDigest` from the record shown.
- Never offer "approve" for approvals the current user requested.
- Treat `context` values (model text) as untrusted content: render as plain text, never HTML/Markdown.
- Policy editor: validate client-side with the same JSON Schema (`schemas/aegis-v1.schema.json#/$defs/PolicyDocument`),
  but treat server validation as authoritative. Show `detectConflicts` findings.
- E2E fixtures: use `packages/contracts/examples/*.json` and `fixtures/contract-cases.json`.

## 3. Integration checklist

- [ ] Root workspaces + CI per §0
- [ ] Evaluate route validates with `EvaluateDecisionRequest` and rejects unknown fields
- [ ] Agent/credential binding enforced (403)
- [ ] Engine input built per §1.2; server-owned attributes overwritten
- [ ] Idempotency by requestId (§1.3)
- [ ] Approval binding + self-approval + CAS consumption (§1.4)
- [ ] Execution authorization minted and verified at a gateway with shared replay store (§1.5)
- [ ] Policy create validates with `compilePolicySet`, immutable versions (§1.6)
- [ ] Audit hash chain + external anchor (§1.7)
- [ ] Error envelope everywhere; fail closed on dependency outage (§1.8)
- [ ] Contract conformance: all `fixtures/contract-cases.json` cases pass against the live server
- [ ] Engine fixtures: `packages/policy-engine/fixtures/*.json` produce the expected effects via the HTTP API

## 4. Backend divergences: status after integration

First recorded from a read-only review of `agent/codex-backend` at `2869183`; re-checked on the integrated
branch (Codex aligned most of them in `eaeef74` and `2638104`).

| #   | Original divergence                                | Status                                                                                                                                                    |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Nested JSON in `context` / `resource.attributes`   | Resolved: flat, bounded attribute schema in `services/api/src/domain.ts`; the live probe rejects body claims (400).                                       |
| D2  | Arguments digest from `context.arguments`          | Resolved: top-level `argumentsDigest`; `services/api/test/contract-interop.test.ts` proves byte-identical digests.                                        |
| D3  | Resolve body without `expectedBindingDigest`       | Resolved: required; a mismatch returns 409 (integration test and live probe).                                                                             |
| D4  | Client-chosen policy versions                      | Resolved: `CreatePolicyRequest` with `expectedLatestVersion`; versions are immutable (database trigger).                                                  |
| D5  | Loose action regex                                 | Resolved: contract action grammar.                                                                                                                        |
| D6  | Lenient local canonicalizer                        | Resolved: rejects undefined and non-plain values; a property test proves byte equality with `canonicalJson`.                                              |
| D7  | Approval TTL bounded by the decision TTL (≤ 300 s) | **Open.** The backend stores approval expiry as `now + ttlSeconds` and caps `ttlSeconds` at 300, so human approvals expire within five minutes. See PR-2. |

The backend's gateway enforces execution server-side by re-deriving the decision from the database
(`decisionId` + request + arguments) and claiming it once, rather than verifying `ExecutionAuthorization`
tokens from `@aegis/contracts/crypto`. Both are server-side enforcement; the token design remains available for
tool services that cannot reach the AEGIS database (PR-3).

## 5. Proposed contract revisions

### PR-1: Read a policy version's document

- Proposed: integration, 2026-11-03. Compatibility: additive.
- Change: `GET /v1/policies/{policyId}/versions/{version}` returning `PolicyVersion` (scope `aegis:policies:read`).
- Rationale: `GET /v1/policies` returns summaries only, so the console cannot display rule bodies.
- Sign-off: backend [ ] dashboard [ ] security [x]

### PR-2: Decouple approval TTL from decision TTL in the backend engine seam

- Proposed: integration, 2026-11-03. Compatibility: internal (no wire change).
- Change: carry `approval.ttlSeconds` (60 s – 7 days) in the backend's internal `PolicyResult`; the engine already returns it.
- Rationale: closes D7.
- Sign-off: backend [ ] dashboard [ ] security [x]

### PR-3: Issue ExecutionAuthorization tokens for remote tool gateways

- Proposed: integration, 2026-11-03. Compatibility: additive (the field already exists in v1).
- Change: populate `executionAuthorization` on ALLOW for actions served by gateways outside the AEGIS database boundary.
- Rationale: lets third-party tool services enforce with `createEnforcementPoint` without database access.
- Sign-off: backend [ ] dashboard [ ] security [x]

Template:

```
### PR-<n>: <title>
Proposed by / date:
Change:
Compatibility class: additive | breaking
Rationale:
Sign-off: backend [ ] dashboard [ ] security [ ]
```
