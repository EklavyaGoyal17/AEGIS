# AEGIS security documentation

| Document                                                                               | Purpose                                                                                                         |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [threat-model.md](threat-model.md)                                                     | Assets, trust boundaries, decision vs. enforcement, threats T1–T18 with tested mitigations, limitations         |
| [policy-precedence.md](policy-precedence.md)                                           | Normative evaluation semantics implemented by `@aegis/policy-engine`                                            |
| [execution-authorization.md](execution-authorization.md)                               | Single-use, bound execution authorization tokens and approval binding                                           |
| [integration-requirements.md](integration-requirements.md)                             | Obligations for backend, gateway and dashboard; integration checklist; observed divergences; proposed revisions |
| [../../packages/contracts/COMPATIBILITY.md](../../packages/contracts/COMPATIBILITY.md) | Frozen v1 contract and what may change in 1.x                                                                   |

## Packages

| Package                  | Role                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `packages/contracts`     | OpenAPI 3.1 + JSON Schema, runtime validators, canonical digests, EA tokens, audit chain |
| `packages/policy-engine` | Deterministic, fail-closed evaluation; conflict detection; simulation; backend adapter   |
| `packages/agent-sdk`     | Fail-closed client, `AegisGuard`, server-side enforcement point                          |

## Running every security check

```bash
cd packages/contracts     && npm ci && npm run check
cd ../policy-engine       && npm ci && npm run check && npm run mutation
cd ../agent-sdk           && npm ci && npm run check
```
