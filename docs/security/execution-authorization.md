# Execution authorization (EA) design

## Problem

A decision (`ALLOW`) answers "may this happen?". It is not proof that the thing executed is the thing that
was evaluated. Without a bound artifact, an agent (or anything that compromised it) could:

- reuse one ALLOW for many executions (replay);
- evaluate small harmless arguments and execute large harmful ones (argument substitution);
- use an ALLOW for resource A against resource B, or another tenant;
- present an approval granted for one request as authority for another;
- act after the agent was suspended (TOCTOU).

## Artifact

A compact JWS (`header.payload.signature`, base64url, no padding):

- Header — exactly `{"alg":"EdDSA","kid":"<key id>","typ":"aegis-ea+jwt"}`. Any other algorithm, type or
  extra header parameter (`jku`, `x5u`, `crit`, …) is rejected.
- Claims (all required, no extras):

| Claim | Meaning |
|---|---|
| `v` | 1 |
| `iss` | issuing decision service |
| `aud` | the enforcement point allowed to accept it (e.g. `crm-tool-gateway`) |
| `jti` | UUID, single use |
| `tid` | tenant |
| `sub` | agent id |
| `prn` | principal the agent acts for |
| `act` | exact action |
| `res` | `{type, id}` |
| `args` | `computeArgumentsDigest(arguments)` or null for argument-less actions |
| `dec` | decision id (audit link) |
| `apr` | approval id consumed to obtain this ALLOW, or null |
| `pv` | policy version used |
| `iat`, `nbf`, `exp` | epoch seconds; `exp - iat ≤ 300` (recommended 60) |

Signing input is `b64url(canonicalJson(header)) + "." + b64url(canonicalJson(claims))`, signed with Ed25519.

## Verification (enforcement point)

`verifyExecutionAuthorization(token, options)` in `@aegis/contracts/crypto`, in this order:

1. Size and shape; strict base64url (non-canonical encodings rejected).
2. Header exact match; `kid` resolves to a configured Ed25519 public key.
3. Signature.
4. Claims schema (no unknown claims).
5. Lifetime cap, `nbf`/`exp` with bounded skew (default 30 s).
6. Audience, then every binding against **what the enforcement point is about to do**: tenant from its own
   auth context, agent, action, resource, arguments digest recomputed from the actual arguments, optionally
   principal.
7. Revocation hook.
8. Atomic consume of `jti` in a shared replay store (last, so failed probes do not burn tokens).

Every failure returns a typed reason; exceptions return `VERIFIER_ERROR`. The function never throws.

## Approval binding

`bindingDigest = sha256(canonical({kind:"aegis.approval-binding/v1", tenantId, agentId, principalId, action,
resource:{type,id}, argumentsDigest}))`. The approver echoes it when resolving; the engine recomputes it from the
resumed request; the server consumes the approval atomically. Different arguments → different digest → DENY.

## Key management

- Private keys live in KMS/HSM; the decision service signs via KMS or holds a short-lived key.
- Publish public keys to enforcement points by configuration (no `jku` fetching). Rotate by adding the new
  `kid`, switching signing, then removing the old `kid` after the max lifetime has passed.

## Limits

- The EA proves the decision service authorized a specific execution. It does not prove the downstream
  system did only that; the adapter must pass exactly the verified arguments.
- An in-process verifier inside an untrusted agent provides no security. The verifier must run in a process
  the agent cannot modify, which holds the downstream credentials the agent does not have.
