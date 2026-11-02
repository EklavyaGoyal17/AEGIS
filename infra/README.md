# AEGIS backend operations

The backend runs on Node 24 with npm and PostgreSQL 17. Work only in `AEGIS-codex` on `agent/codex-backend`. This branch does not include the console, SDK, or canonical packages from other branches.

## Start the isolated local stack

From the repository root:

```powershell
npm ci
npm run dev:init
docker compose --env-file .backend-tmp/compose.env -f infra/compose.yaml up --build -d --wait
npm run smoke
docker compose --env-file .backend-tmp/compose.env -f infra/compose.yaml exec -T api node dist/infra/verify-audit.js 10000000-0000-4000-8000-000000000001
```

`dev:init` generates credentials and an RSA keypair under ignored `.backend-tmp/`. It retains existing credentials. The private signing key stays on the host; containers receive only the public key. Do not commit this directory. On shared hosts restrict its ACL to the developer account. `smoke` mints five-minute local JWTs in memory, evaluates an action, reviews its binding, approves it, creates a real PostgreSQL-backed note through the gateway, and verifies that a retry returns the same execution ID.

API: `http://127.0.0.1:3000`; gateway: `http://127.0.0.1:3001`. PostgreSQL and the demo tool have no published ports. The seed delegation expires after 24 hours. Seeding never silently renews an expired or revoked grant. A database administrator must explicitly renew a development grant or provision a fresh environment. No real external services are called.

The local policy adapter is an explicitly enabled, fixed integration fixture. It accepts one exact demo policy and requires a human approval for the demo action. It does not interpret the policy DSL. Production mode rejects this fixture. The default production adapter denies missing policies and fails closed for configured policies until the canonical package is installed and built.

Stop while retaining data:

```powershell
docker compose --env-file .backend-tmp/compose.env -f infra/compose.yaml down
```

Do not remove the database volume to solve an authorization error; inspect the delegation, approval, policy and execution evidence.

## Processes and configuration

Build with `npm run build`. Start API with `node dist/services/api/src/main.js`, gateway with `node dist/services/gateway/src/main.js`, and the isolated demo service with `node dist/services/demo-tool/src/main.js`. Run schema migrations with `node dist/db/migrate.js` using a migration-owner database credential. `GRANT_RUNTIME_ROLE=true` grants permissions to the pre-provisioned `aegis_app` role. Normal processes must use the restricted runtime role.

See `.env.example` for configuration names. Supply credentials through your deployment's secret manager. Runtime requires `DATABASE_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`, `CURSOR_SIGNING_KEY`, and either an HTTPS `JWT_JWKS_URL` or a trusted `JWT_PUBLIC_KEY_FILE`. Gateway additionally requires a configured connector origin and secret. `HOST` defaults to loopback. The Compose configuration is explicitly for local development and sets `NODE_ENV=development` and `ENABLE_LOCAL_DEMO_POLICY=true`.

`GET /v1/health` is unauthenticated liveness. `GET /internal/ready` checks the migration and configured adapter; keep internal endpoints behind your deployment network. `GET /internal/metrics` requires the server-managed `audit:read` role and exports Prometheus counters/histograms with bounded route/status labels. Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and `OTEL_SERVICE_NAME` to export HTTP spans to your collector. Traces contain method, route, status and correlation ID, not bodies, credentials or arbitrary URLs. Export is optional and must not grant authorization.

SIGINT/SIGTERM stop accepting requests, drain Fastify, finish the current maintenance pass and close the pool within a bounded shutdown period. Maintenance runs every ten seconds. It expires approvals and marks execution claims older than sixty seconds `UNKNOWN`. Multiple replicas may run maintenance; tenant locks serialize transitions.

## Verification

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
$env:AEGIS_CONTRACT_SCHEMA = 'path/to/packages/contracts/schemas/aegis-v1.schema.json'
$env:AEGIS_CANONICAL_ENGINE_MODULE = 'file:///path/to/packages/policy-engine/dist/index.js'
npm run test:integration
npm run build
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=high
```

Integration tests launch a disposable PostgreSQL Testcontainer and an isolated real HTTP demo service. They exercise invalid/expired credentials, tenant isolation, grants, duplicate requests, approval authority and expiry, concurrent resolution/consumption, exact argument binding, policy failures/timeouts, malicious tool responses, injected database failures before and after a side effect, crash recovery, database privileges, and audit tampering. The canonical schema test is explicitly skipped when `AEGIS_CONTRACT_SCHEMA` is absent; actual-engine tests are skipped when `AEGIS_CANONICAL_ENGINE_MODULE` is absent. CI checks out the published contract at a pinned revision and sets both variables; it does not claim that the other branches have been merged.

GitHub Actions also build the container, start Compose, run the smoke test, scan dependencies and scan Git history with Gitleaks. Production dependency audit is clean at validation time. Development tooling currently has moderate transitive glob/minimatch advisories; no high/critical advisories were reported. CI reports these and fails on high/critical development advisories or any moderate production advisory. Do not apply the scanner's suggested major downgrades or `--force` automatically.

## Recovery and evidence

An approval authorizes one original principal, tenant, agent, operation, resource, argument digest and immutable policy snapshot. Policy activation cancels outstanding approvals. Revoking the requester's delegation or the human approver's required role blocks execution. A duplicate execution returns the original state without making another tool call.

`STARTED` means the durable execution claim committed. `SUCCEEDED` means the demo adapter acknowledged success and the outcome committed. `UNKNOWN` means delivery or persistence was ambiguous. Inspect the isolated tool's execution ID and the evidence before taking a new action. There is deliberately no automatic retry or endpoint that resurrects consumed approvals.

Public canonical audit events and internal operational evidence have separate transactionally maintained hash chains. The internal chain records requests, denials and execution outcomes beyond the public contract's event enum. `verify-audit` verifies both complete chains and their stored heads. Use a migration-owner connection for incident inspection; never give database-owner credentials to an agent or API process. See `SECURITY.md` for limits and `INTEGRATION.md` for cross-branch work.
