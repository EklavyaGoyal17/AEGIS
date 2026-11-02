# @aegis/contracts — AEGIS API v1

Single source of truth for the AEGIS v1 wire contract.

| Artifact | Path | Notes |
|---|---|---|
| OpenAPI 3.1 | `openapi/aegis-v1.yaml` | Generated. Do not edit by hand. |
| JSON Schema 2020-12 bundle | `schemas/aegis-v1.schema.json` | Generated. Address entities as `#/$defs/<Name>`. |
| Examples | `examples/*.json` | Validated in CI against both TypeBox and Ajv. Digests are real. |
| Conformance cases | `fixtures/contract-cases.json` | Accept/reject cases every server and client must agree with. |
| TS types + runtime validators | `src/` → `dist/` | `validate(Schema, value)` never throws, never coerces. |
| Crypto helpers (Node only) | `@aegis/contracts/crypto` | Canonical digests, approval binding, audit hash chain, execution authorization tokens. |

Sources live in `src/` as TypeBox schemas; `npm run generate` emits the OpenAPI and JSON Schema files, and
`npm run check:generated` fails CI if the committed files drift from the sources.

## Commands

```bash
npm install
npm run typecheck
npm test
npm run check:generated
npm run build        # emits dist/ (required before other packages are built for production)
```

## Key rules (summary — see `COMPATIBILITY.md` and `docs/security/`)

- Request bodies never carry tenant, principal, role or permission data; unknown request fields are rejected.
- `context` and caller-supplied `resource.attributes` are untrusted claims.
- All timestamps are RFC 3339 **UTC** (`Z`), validated for calendar correctness.
- UUIDs are canonical lowercase.
- Attribute maps are flat (scalars or flat lists), at most 64 keys matching `^[A-Za-z][A-Za-z0-9_]{0,63}$`.
- An `ALLOW` is not an execution credential. Protected tools require a single-use `ExecutionAuthorization`
  verified by a trusted enforcement point (`verifyExecutionAuthorization`).
- Approvals are bound by `bindingDigest` (tenant, agent, principal, action, resource, arguments digest) and the
  approver must echo it when resolving.

## Canonical JSON

Digests use the AEGIS canonical JSON encoding (`src/canonical.ts`), a strict subset of RFC 8785: sorted keys
(UTF-16 code-unit order), no whitespace, ECMAScript number formatting, only plain JSON values, depth ≤ 32.
Non-TypeScript implementations must reproduce the test vectors in `test/canonical.test.ts` byte-for-byte.
Every digest is domain-separated by a `kind` field (`aegis.arguments/v1`, `aegis.approval-binding/v1`,
`aegis.audit-event/v1`).
