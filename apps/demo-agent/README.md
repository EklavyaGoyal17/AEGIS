# AEGIS Demonstration Agent

A support agent that wants to write notes into a customer system — and can only do so through AEGIS.

## Live scenario (`npm run demo`) — enforced by the running stack

`src/live.ts` uses `@aegis/agent-sdk` against the real API and executes only through the trusted gateway. The
agent holds no credential for the note system; only the gateway does. There is **no simulated fallback**: if
AEGIS is unreachable or says no, nothing executes.

1. **Undelegated action denied** — `demo.note.delete` is rejected before evaluation (no delegation).
2. **Prompt injection ignored** — context claiming `approved: true` still yields `REQUIRE_APPROVAL`.
3. **Approval required** — `demo.note.create` is held; the gateway refuses to execute while pending.
4. **Human review** — approve the request in the console at `http://localhost:3100/approvals`
   (or set `AEGIS_DEMO_AUTO_APPROVE=true` to approve as the seeded reviewer).
5. **Single execution** — the gateway executes once; a replay returns the same execution; swapped arguments are refused.

```bash
# From the repository root, with the Compose stack running (see the root README)
npm run demo
```

Configuration: `AEGIS_API_URL` (default `http://127.0.0.1:3000`), `AEGIS_GATEWAY_URL` (default
`http://127.0.0.1:3001`), `AEGIS_AGENT_TOKEN` (production workload token; locally a short-lived token is signed
with the key from `npm run dev:init`), `AEGIS_DEMO_APPROVAL_WAIT_MS`.

## Offline simulation (`npm run demo:simulated`)

`src/scenario.ts` replays the original customer-support storyline against an in-process simulator using
synthetic records only. It never contacts AEGIS and authorizes nothing real; it exists to show the narrative
without a backend.
