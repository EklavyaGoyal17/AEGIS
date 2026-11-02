# Cross-branch integration

Backend branch: `agent/codex-backend`. The repository began empty and the branches have independent roots. Do not merge or rewrite another agent's branch from this worktree. No `main` branch currently exists; GitHub selected the first pushed backend branch as the default. A PR into `main` cannot be created until the repository owner establishes a common integration base. This branch has not created or pushed `main`.

The backend validates all seven public endpoint response shapes against Claude's canonical JSON Schema. CI pins the published contract commit `69d658f8b93914cfd67f86d4a13f61cbc5f6de0e` in an ignored second checkout solely for compatibility testing. It does not merge the contract or publish a competing canonical schema. Root npm workspaces support `services/*`, `packages/*`, and `apps/*`; backend TypeScript/lint scopes deliberately exclude other agents' code. The integration owner must combine dependency manifests, regenerate the root npm lockfile once and extend aggregate checks to the canonical packages and apps.

## Public API

Implemented: evaluation, human approval resolution, approval listing, canonical audit listing, policy listing/creation and health. Approval resolution uses `{decision, expectedBindingDigest, comment?}` and optional `Idempotency-Key`; policy creation uses `{policyId,name,description?,document,activate,expectedLatestVersion}` and returns 201. List cursors are HMAC-signed, tenant/filter-bound and expire after one hour. Server-managed roles map `approval:read` to approval reads, policy:read to policy reads, policy:admin to policy writes, audit:read to audit/metrics reads, and the policy-selected approval role to resolution. Agents need a matching live delegation; gateway callers also need `tool:execute` and a registered connector identity.

The evaluator accepts optional canonical `argumentsDigest` and `approvalId`. Raw tool arguments do not travel in canonical context attributes. When resuming an approved evaluation, the response remains advisory; the original gateway decision/approval must still be consumed atomically before a tool call. This backend issues no portable execution token. Shared Ed25519 execution-artifact issuance is separate integration work; do not advertise the current ALLOW as such an artifact.

## Proposed private gateway contract — coordination required

The execution transport is intentionally on a separate listener and is not added to the frozen public OpenAPI:

```json
{
  "decisionId": "UUID of the original persisted decision",
  "request": {
    "requestId": "original UUID",
    "agentId": "demo-agent",
    "action": "demo.note.create",
    "resource": { "type": "note", "id": "note-id", "attributes": {} },
    "context": {},
    "argumentsDigest": "sha256:..."
  },
  "arguments": { "text": "synthetic demo note" }
}
```

`POST /internal/v1/executions` returns `{executionId,state}`. Only a trusted machine connector may call it; the exact original request and recomputed argument digest must match the decision. Retried calls report the same attempt, including STARTED or UNKNOWN. Coordinate this proposed internal transport with Claude and Antigravity before SDK/console adoption. No token-based public execution endpoint has been invented.

## Remaining integration gates

Install/import Claude's canonical engine through the typed `PolicyEngine` seam, supply verified registry/delegation/environment context and preserve its policy-set version semantics. Runtime currently supports an explicit trusted `AEGIS_POLICY_ADAPTER_MODULE` factory, a fail-closed default and an opt-in local fixture. The local fixture is never a production fallback. Re-run compatibility, actual-engine tests and gateway failure tests after integrating the shared packages.

Antigravity must configure real JWT authentication and call these real APIs; this branch does not change its console or demo-agent files. Resource metadata must be resolved by a trusted connector/catalog before policies depend on it. Human provisioning, production grant/connector administration, real customer connectors and external audit anchoring are not covered by the seven frozen routes. See SECURITY.md before enabling a production deployment.
