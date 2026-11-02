# AEGIS — Shared Integration Requirements

This document captures integration dependencies, runtime contract alignments, and shared root/build configuration needs identified by the Product & Frontend engineering team (`agent/antigravity-product`).

In accordance with strict code ownership, Antigravity has **not** modified shared root build files, `packages/**`, or backend services directly.

---

## 1. Monorepo Workspace Configuration

To allow seamless monorepo orchestration across `apps/*` and `packages/*`, the root `package.json` should specify workspace boundaries:

```json
{
  "name": "aegis-workspace",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "services/*"],
  "scripts": {
    "dev:console": "npm run dev --workspace=apps/console",
    "build:console": "npm run build --workspace=apps/console",
    "test:console": "npm run test --workspace=apps/console",
    "test:e2e": "playwright test --config=tests/e2e/playwright.config.ts",
    "demo:agent": "npm run demo --workspace=apps/demo-agent"
  }
}
```

---

## 2. Shared API V1 Alignment

The AEGIS Security Console integrates with the Policy Engine and Gateway via the frozen V1 API contract:

| Endpoint                     | HTTP Method | Expected By Console                    | Production Status  |
| :--------------------------- | :---------: | :------------------------------------- | :----------------- |
| `/v1/decisions/evaluate`     |   `POST`    | Pre-execution decision evaluation      | Frozen V1 Contract |
| `/v1/approvals`              |    `GET`    | List pending/resolved approvals        | Frozen V1 Contract |
| `/v1/approvals/{id}/resolve` |   `POST`    | Authorize or reject held operations    | Frozen V1 Contract |
| `/v1/audit/events`           |    `GET`    | Retrieve chronological audit trail     | Frozen V1 Contract |
| `/v1/policies`               |    `GET`    | Retrieve defined policy list           | Frozen V1 Contract |
| `/v1/policies`               |   `POST`    | Create structured authorization policy | Frozen V1 Contract |
| `/v1/health`                 |    `GET`    | System and sub-service health check    | Frozen V1 Contract |

### Gateway CORS and Headers

The backend gateway should provide CORS headers in local development:

- `Access-Control-Allow-Origin: http://localhost:3100` (Console default)
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization, X-Correlation-ID, X-Aegis-Agent-Id`

---

## 3. Policy Schema & Type Contracts

When Claude's authorization contracts and SDK packages (`packages/sdk`, `packages/policy-engine`) are finalized:

- The Console will import generated TypeScript types directly from the shared workspace package `@aegis/contracts` or `@aegis/types`.
- Until then, the Console relies on local, contract-aligned Zod schemas in `apps/console/src/lib/api/types.ts`.

---

## 4. Test Orchestration in CI

To run full end-to-end integration tests in GitHub Actions:

1. Start the Gateway and Database mock / live instance on port `3200`.
2. Start the Console on port `3100` (`npm run start --workspace=apps/console`).
3. Execute `npx playwright test --config=tests/e2e/playwright.config.ts`.
