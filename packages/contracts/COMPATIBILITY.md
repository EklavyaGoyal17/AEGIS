# AEGIS API v1 — compatibility policy

Status: **v1.0.0, frozen** (2026-11-02). Owner: security/contracts (`agent/claude-security`).

## What "frozen" means

The seven v1 routes, their methods, required fields, field types, and semantics will not change in a
backward-incompatible way within `/v1`. Breaking changes require a new path prefix (`/v2`) and a coordinated
deprecation window agreed by backend, dashboard and SDK owners.

## Allowed within 1.x (additive, non-breaking)

| Change | Server obligation | Client obligation |
|---|---|---|
| New **optional** request field | Must keep accepting requests without it | — |
| New response field | — | MUST ignore unknown response fields |
| New reason code | — | MUST treat unknown codes as opaque; never derive authorization from them |
| New error code | Must use HTTP status consistent with its class | MUST treat unknown codes as **non-retryable** |
| New enum value in a response enum (e.g. `ApprovalStatus`) | — | MUST handle unknown values as "not actionable" |
| New audit event type | — | MUST tolerate it |
| New route | — | — |
| Tightened server-side limits | Only with a minor version bump and notice | Must handle 400/413 |

## Never allowed within v1

- Removing or renaming a field, route or enum value.
- Making an optional request field required (except the documented `argumentsDigest` server opt-in for tools
  that issue execution authorizations — servers may require it per action and reject with 400).
- Accepting tenant, principal, role, scope or permission data in request bodies.
- Changing the canonical JSON algorithm or any digest's `kind` domain separator.
- Changing decision precedence (DENY > REQUIRE_APPROVAL > ALLOW, default DENY).
- Loosening request validation such that previously rejected unknown fields are silently accepted.

## Request vs. response strictness

- Requests: `additionalProperties: false` everywhere. Servers MUST reject unknown fields with 400 INVALID_REQUEST.
- Responses: open for extension. Clients (including `@aegis/agent-sdk`) validate required fields and types and
  ignore extra fields.

## Proposed revisions

Record proposals in `docs/security/integration-requirements.md` under "Proposed contract revisions" with
rationale, compatibility class, and owner sign-off. Nothing in this document is changed unilaterally.

## Versioning of artifacts

- `info.version` in `openapi/aegis-v1.yaml` follows SemVer and equals `API_VERSION` in `src/api.ts`.
- Policy documents carry `schemaVersion: "aegis.policy/v1"`; a v2 DSL would be a new literal, and v1 engines
  reject documents with any other value.
- Execution authorization tokens carry `v: 1` and `typ: aegis-ea+jwt`; verifiers reject other values.
