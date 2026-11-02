# @aegis/agent-sdk

Fail-closed TypeScript client for the AEGIS v1 API, a guard for protected tool calls, and a **server-side**
enforcement point for tool gateways. Node ≥ 20.11 (uses `node:crypto`).

> **What this SDK does not do.** Code running inside an agent can be skipped, patched or prompt-injected
> into misuse. The client and `AegisGuard` make correct integrations easy and auditable; they are **not** a
> security boundary. Protection exists only when the protected system is reachable solely through a trusted
> gateway that verifies execution authorizations (`@aegis/agent-sdk/enforcement`) and holds the credentials
> the agent does not have. See `docs/security/threat-model.md`.

## Agent side

```ts
import { AegisClient, AegisGuard, AegisApprovalRequiredError, AegisDeniedError } from '@aegis/agent-sdk';

const client = new AegisClient({
  baseUrl: 'https://aegis.example.com',
  credentials: { getToken: async (signal) => broker.token(signal) }, // injected; never logged
  timeoutMs: 3000,      // per attempt
  deadlineMs: 8000,     // total, including retries
});
const guard = new AegisGuard(client);

await guard.execute(
  { agentId, action: 'crm.customers.export', resource, args },
  async ({ executionAuthorization, args }) => gateway.export(args, executionAuthorization!.token),
);
```

`execute` calls the executor **at most once**, and only after an unexpired `ALLOW` that carries an
execution authorization bound to the digest of the exact (snapshotted, frozen) arguments. It throws:

| Error | Meaning | Executor called? |
|---|---|---|
| `AegisDeniedError` | DENY | no |
| `AegisApprovalRequiredError` | REQUIRE_APPROVAL; `.approvalId` to resume after a human approves | no |
| `AegisAuthorizationExpiredError` | decision or authorization expired before execution | no |
| `AegisValidationError` | request/args violate the contract (no network call made) | no |
| `AegisTimeoutError`, `AegisUnavailableError`, `AegisCancelledError` | service not reachable in time | no |
| `AegisAuthError`, `AegisApiError`, `AegisProtocolError` | credential, server or contract errors | no |

Resume after approval by calling `execute` again with the **same args** and `approvalId`. Different args
produce a different digest and are denied (`APPROVAL_BINDING_MISMATCH`). Approvals are single use.

## Client behaviour

- Requests are validated against the frozen contract before sending; responses are validated on receipt and
  cross-checked (e.g. REQUIRE_APPROVAL must carry an approvalId; an execution authorization must be bound to
  the request that was sent). Unknown response fields are ignored.
- Retries: only network errors, per-attempt timeouts, and 429/502/503/504 (unless the server's envelope says
  `retryable: false`), only for idempotent operations (evaluate is idempotent by `requestId`; resolve/create
  carry an `Idempotency-Key`), with jittered exponential backoff, `Retry-After` (capped), max 5 attempts, and
  an overall deadline. 4xx and 500 are never retried.
- `redirect: 'error'` so the bearer token is never sent to another origin; `https` required except localhost.
- A fresh token is requested per attempt; tokens with whitespace/CRLF are rejected.
- Responses larger than 1 MiB are rejected.
- Logs are structured (`aegis.request` with op, attempt, status, duration, correlationId) and redacted:
  tokens, context, attributes and arguments never reach the logger. A throwing logger cannot change outcomes.

## Gateway side (trusted)

```ts
import { createEnforcementPoint } from '@aegis/agent-sdk/enforcement';

const gateway = createEnforcementPoint({ audience: 'crm-tool-gateway', keys, replayStore, isRevoked });
await gateway.execute({ token, tenantId, agentId, action, resource, args }, (verifiedArgs) => crm.export(verifiedArgs));
```

The gateway recomputes the arguments digest from the arguments it is about to execute, verifies the token
(signature, algorithm, audience, lifetime, every binding), checks revocation, consumes the token once, and
only then runs the call with the verified frozen arguments. `replayStore` must be shared and atomic across
replicas.

## Integrating agent frameworks (conceptual — no adapters ship in this package)

No framework adapters exist yet, so no framework is "protected" by installing this package. The integration
pattern for any framework (LangChain/LangGraph tools, OpenAI/Anthropic tool-use loops, MCP servers, etc.):

1. Wrap each protected tool's implementation in `guard.execute(...)` and return a model-readable message on
   `AegisDeniedError` / `AegisApprovalRequiredError` instead of retrying.
2. Move the actual side effect behind a gateway that uses `createEnforcementPoint`; the agent runtime gets no
   direct credentials for the protected system.
3. Never let the model choose `agentId`, `approvalId` sources, or resource attributes the server owns; treat
   everything the model produces as `context` (untrusted).
4. For MCP: run the enforcement point inside the MCP **server** (the trusted side), not the client.

## Commands

```bash
npm install
npm run typecheck
npm test        # unit tests + end-to-end tests against an in-memory reference backend
npm run build   # requires ../contracts (and ../policy-engine for tests) built for production use
```

`test/mock-backend.ts` is a compact reference of the server obligations (identity binding, idempotency,
server-owned attributes, approval binding and atomic consumption, execution-authorization minting).
