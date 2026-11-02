# Backend validation record — 2026-11-03

Validation was performed in `AEGIS-codex` on `agent/codex-backend`, with Node 24.13.1, npm 11.8.0 and Docker Engine 29.5.3.

| Check                                                                | Actual result                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run format:check`                                               | Passed                                                                                |
| `npm run lint`                                                       | Passed                                                                                |
| `npm run typecheck`                                                  | Passed                                                                                |
| `npm test`                                                           | 6 tests passed, including a real OTLP HTTP export and credential-redaction check      |
| `npm run test:integration` with both canonical environment variables | 36 tests passed, no skipped tests                                                     |
| `npm run build`                                                      | Passed                                                                                |
| `npm audit --omit=dev --audit-level=moderate`                        | 0 vulnerabilities                                                                     |
| `npm audit --audit-level=high`                                       | Exit 0; 17 moderate transitive development-tool advisories, no high/critical findings |
| Compose build/start/readiness                                        | Passed with migration and seed jobs completing successfully                           |
| `npm run smoke`                                                      | Real note creation succeeded; duplicate request returned the original execution ID    |
| Container `verify-audit` command                                     | Both audit chains verified successfully                                               |

Canonical schema and engine tests use Claude's published commit `74774148633aae841d9351b237c5f7dfe20f9edc`, built in an ignored reference checkout. No source files from another agent's branch were edited or merged. Tests compare policy-version strings, argument/approval digests and public audit hashes with the actual canonical implementation. CI checks out and builds this same pinned source before running these tests.

The integration suite uses fresh Testcontainers databases and the real isolated demo HTTP service. Controlled failures cover unavailable/timed-out policy evaluation, rejected audit writes before side effects, outcome-persistence failures after side effects, network uncertainty, stale-worker recovery, and cancellation before claiming execution. Concurrent requests assert one durable execution and one actual note, not merely a single mocked adapter invocation.

This validates the backend branch and its independent-package integration seam. It does not validate a merged console/SDK deployment, external customer connectors, portable execution tokens, independent audit anchoring or production infrastructure. See INTEGRATION.md and SECURITY.md for the remaining gates and limits.
