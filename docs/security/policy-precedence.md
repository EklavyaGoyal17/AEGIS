# AEGIS policy evaluation semantics (v1)

This document is normative. `@aegis/policy-engine` implements it and its tests reference these sections.

## 1. Inputs and trust levels

The engine never sees raw HTTP. The backend builds an `EvaluationInput` from:

| Input | Source | Trusted? |
|---|---|---|
| `tenantId` | Verified credential | Yes |
| `agent` (`AgentIdentity`) | Server registry, looked up by the **authenticated** agent | Yes |
| `principal` (`Principal`) | Server registry (the principal the agent acts for) | Yes |
| `grants` (`DelegatedAuthority[]`) | Server-managed grant store | Yes |
| `environment` (`env.*`) | Server-derived (network zone, MFA freshness, business hours, …) | Yes |
| `resource.attributes` | Server resource catalog **merged over** caller claims; server-owned keys overwritten | Partially (see §8) |
| `request.context` | Caller (often model-generated) | **No** |
| `approval` | Server approval store, looked up by `request.approvalId` within the tenant | Yes |
| `now` | Server clock (the engine never reads a clock) | Yes |

Nothing the model says ("this is safe", "the user approved", `context.approved = true`) can change a decision
unless a policy author explicitly wrote a rule referencing `request.context.*`. The conflict detector flags any
ALLOW rule that depends on `request.context.*`.

## 2. Evaluation order (first failure wins; every failure is DENY unless stated)

1. **Input validation** — schema + semantic checks (bounded sizes, RFC 3339 UTC, request/resource consistency).
   Failure → `DENY INVALID_INPUT`.
2. **Policy set validation** — every document compiles. Failure → `DENY POLICY_INVALID`.
3. **Tenant binding** — `policySet.tenantId === input.tenantId`. Failure → `DENY POLICY_TENANT_MISMATCH`.
4. **Version pin** — if `expectedPolicyVersion` is supplied it must equal the computed version.
   Failure → `DENY POLICY_VERSION_MISMATCH`.
5. **Non-empty policy set** — Failure → `DENY NO_ACTIVE_POLICY`.
6. **Identity** — agent id equals the request's agentId (`AGENT_IDENTITY_MISMATCH`), agent tenant
   (`AGENT_TENANT_MISMATCH`), agent ACTIVE (`AGENT_INACTIVE`), principal tenant (`PRINCIPAL_TENANT_MISMATCH`),
   principal ACTIVE (`PRINCIPAL_INACTIVE`).
7. **Action catalog** — if any policy declares `actionCatalog`, the action must be in the union of catalogs.
   Failure → `DENY ACTION_UNSUPPORTED`.
8. **Delegated authority** (§4). Failure → `DENY DELEGATION_*`.
9. **Rules** (§3) produce ALLOW, DENY, REQUIRE_APPROVAL or DEFAULT_DENY.
10. **Approval resolution** (§5) only when step 9 yields REQUIRE_APPROVAL.

Any exception, any exhausted evaluation budget, or any unexpected state → `DENY INTERNAL_ERROR` /
`DENY EVALUATION_BUDGET_EXCEEDED`. The engine has no code path that returns ALLOW from an error.

## 3. Rule matching and precedence

A rule **applies** when all of the following hold:

- `actions` contains a matching pattern: `*`, the exact action, or a namespace prefix `ns.*` that matches
  `ns.<anything>` (segment-aligned: `crm.*` matches `crm.customers.export`, not `crmx.read`).
- `resourceTypes` contains `*` or the exact resource type.
- `sensitivity` range (if present) contains the resource's sensitivity.
- `timeWindows` (if present): at least one window contains `now`.
- `when` (if present) evaluates as described in §6.

Precedence is by **effect only** — there are no numeric priorities and rule order never matters:

```
any applicable DENY             → DENY  (EXPLICIT_DENY)
else any REQUIRE_APPROVAL       → REQUIRE_APPROVAL (APPROVAL_REQUIRED) → §5
else any ALLOW                  → ALLOW (POLICY_ALLOW)
else                            → DENY  (DEFAULT_DENY)
```

Multiple policies in a tenant's policy set are combined as one rule set with the same precedence. Approval
TTL when several REQUIRE_APPROVAL rules apply = the **minimum** of their `ttlSeconds`. Decision TTL = the
minimum `decisionTtlSeconds` across policies (default 60 s, max 300 s).

## 4. Delegated authority

An agent's effective authority = (union of its valid grants) ∩ (tenant policy). A grant is **valid** for the
request when: same tenant, same agent, `delegatorPrincipalId` equals the principal, `revokedAt` is null,
`notBefore ≤ now < expiresAt`, an action pattern matches, a scope matches the resource type (and id when
`resourceIds` is present), and resource sensitivity ≤ `maxSensitivity`.

If no grant is valid, the reason reflects the closest miss in this order of specificity:
`DELEGATION_REVOKED`, `DELEGATION_EXPIRED`, `DELEGATION_NOT_YET_VALID`, `DELEGATION_SENSITIVITY_EXCEEDED`
(grant covers action/resource but not sensitivity), `DELEGATION_SCOPE_EXCEEDED` (grants exist but none
covers), `DELEGATION_MISSING` (no grants for this agent and principal).

Grants never widen policy. A policy ALLOW without a covering grant is DENY.

## 5. Approvals

Approvals cannot override DENY — §5 runs only when rules produced REQUIRE_APPROVAL.

| Situation | Result |
|---|---|
| No `approvalId` in request | REQUIRE_APPROVAL `APPROVAL_REQUIRED` (server creates an approval) |
| `approvalId` given, server found none in this tenant | DENY `APPROVAL_NOT_FOUND` |
| Approval belongs to another tenant | DENY `APPROVAL_TENANT_MISMATCH` |
| Binding digest ≠ digest of the current request | DENY `APPROVAL_BINDING_MISMATCH` |
| Status CONSUMED | DENY `APPROVAL_ALREADY_CONSUMED` |
| Status REJECTED / CANCELLED | DENY `APPROVAL_REJECTED` |
| Status PENDING | REQUIRE_APPROVAL `APPROVAL_PENDING` |
| Status EXPIRED, or `now ≥ expiresAt` | REQUIRE_APPROVAL `APPROVAL_EXPIRED` (a new approval is needed) |
| Resolved by the requesting principal or the agent | DENY `APPROVAL_SELF_RESOLVED` |
| Approval's `policyVersion` ≠ current | REQUIRE_APPROVAL `APPROVAL_POLICY_VERSION_CHANGED` |
| APPROVED, all checks pass | ALLOW `APPROVAL_SATISFIED`; output `consumesApprovalId` |

The server MUST transition the approval `APPROVED → CONSUMED` with a compare-and-set in the same transaction
that records the ALLOW decision. If the CAS fails, the server MUST return DENY (`APPROVAL_ALREADY_CONSUMED`).
This closes the double-spend race between concurrent evaluations.

## 6. Conditions: three-valued logic

Conditions evaluate to TRUE, FALSE or UNKNOWN (Kleene K3):

- A reference to a missing attribute, or a comparison between mismatched types (e.g. `"10" < 5`), or `lt/gt`
  on non-numbers/non-strings, yields UNKNOWN. No implicit type coercion ever happens.
- `exists` is always TRUE/FALSE.
- `all`: FALSE if any FALSE, else UNKNOWN if any UNKNOWN, else TRUE. `any`: dual. `not UNKNOWN = UNKNOWN`.
- `eq`/`ne` compare scalars by type and value (strings exactly, no case folding or normalisation); comparing a
  list attribute with `eq` is UNKNOWN. `in` is TRUE if the left scalar equals any element of the right list.

**Fail-safe mapping of UNKNOWN to rule applicability:**

| Rule effect | TRUE | FALSE | UNKNOWN |
|---|---|---|---|
| ALLOW | applies | no | **no** |
| DENY | applies | no | **applies** (+ `CONDITION_INDETERMINATE`) |
| REQUIRE_APPROVAL | applies | no | **applies** (+ `CONDITION_INDETERMINATE`) |

Restrictive rules fail toward applying; permissive rules fail toward not applying. Authors who want a DENY to
apply only when an attribute is present must say so with `exists`.

## 7. Sensitivity

Order: `public < internal < confidential < restricted`. A missing or unrecognised
`resource.attributes.sensitivity` is treated as **restricted**. Hence an ALLOW with `max: confidential` does not
apply to unclassified data, and a DENY with `min: restricted` does.

## 8. Server-owned resource attributes

The backend MUST overwrite (not merge) these caller-supplied `resource.attributes` keys from its own catalog
before evaluation, or delete them if the catalog has no value: `sensitivity`, `classification`, `ownerTenantId`,
`owner`, `dataResidency`. Attributes that describe the requested operation (e.g. `recordCount`,
`destination`) are claims bound by `argumentsDigest`; the trusted enforcement point MUST derive or re-check
them from the actual arguments before execution.

## 9. Time windows

Fixed UTC offsets only (`+05:30`), weekday set, `start` inclusive, `end` exclusive, `start < end`
(overnight windows are expressed as two windows). IANA zones are excluded in v1 so evaluation is identical on
every host regardless of tz database version.

## 10. Determinism and bounds

- The output is a pure function of `(policySet, input)`. Same input → deep-equal output, including the trace.
- Iteration order is fixed: policies sorted by `policyId`, rules in document order, grants sorted by `grantId`.
- Bounds: ≤ 64 policies, ≤ 256 rules per policy, condition depth ≤ 8, ≤ 128 nodes per condition, literal
  lists ≤ 256, ≤ 64 grants, plus a global evaluation step budget. No regular expressions anywhere.
- `policyVersion` = `r<revision>.<first 12 hex of sha256(canonical policy set)>`. Any change to any document
  changes it.
