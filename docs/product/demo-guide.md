# AEGIS — Demonstration & Evaluation Guide

This guide walks through running the AEGIS Security Console, executing the safe synthetic demo scenario, and observing live policy enforcement.

---

## 1. Quick Start

> [!IMPORTANT]
> Integrated release: the console defaults to the **live API** through its server-side proxy, and
> `npm run demo` runs the live, enforced scenario. Follow "Getting started" and "Run the demo" in the root
> `README.md`. The steps below describe the explicitly labelled **simulation** mode, kept for offline demos.

### Starting the Security Console (simulated data)

```bash
# from the repository root
NEXT_PUBLIC_DEMO_MODE=true npm run dev:console
```

Open your browser at **`http://localhost:3100`**. The top bar shows "Simulated data".

---

## 2. Running the Demo Agent simulation

In a separate terminal:

```bash
npm run demo:simulated -w @aegis/demo-agent
```

The script runs an offline customer support scenario (no AEGIS calls, nothing real is authorized):

1. **Safe Ticket Ingestion (`ALLOW`)**: Agent retrieves synthetic ticket `tkt-8821`. Gateway returns `ALLOW` under policy `Allow Customer Data Reads`.
2. **Customer Profile Read (`ALLOW`)**: Agent checks customer tier. Gateway returns `ALLOW`.
3. **Data Exfiltration Attempt (`DENY`)**: Agent attempts bulk export of `customer-data/pii/*`. Gateway immediately rejects with `DENY` under policy `Block PII Exports`.
4. **Restricted Mutation (`REQUIRE_APPROVAL`)**: Agent attempts to change customer phone number. Gateway halts execution and generates Approval ID `sim-appr-...`.
5. **Human Review**: Reviewer approves or rejects in the Console UI at `/approvals`.
6. **Execution Release**: Once authorized, the gateway allows the agent to finalize the operation.

---

## 3. Console Exploration Checklist

| Step  | Page            | What to Verify                                                                                                                                           |
| :---: | :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | `/` (Overview)  | Verify KPI cards (Pending Approvals, Blocked Actions), Urgent Action Queue, and Audit Stream.                                                            |
| **2** | `/activity`     | Filter by Outcome `DENY` to observe intercepted export attempts with redacted PII arguments.                                                             |
| **3** | `/approvals`    | Click **"Authorize & Release"** on a pending approval. Provide a reviewer audit justification note and confirm. Notice the card transitions to Approved. |
| **4** | `/policies`     | Click on **"Block PII Exports"** to view human-readable conditions and underlying AST JSON. Click **"New Policy Rule"** to test structured creation.     |
| **5** | `/audit`        | Search by correlation ID `c0c0c0c0-0001-4ccc-7777-000000000001` to view the chronological story arc across reads, modifications, and approvals.          |
| **6** | `/integrations` | Inspect the code patterns for `@aegis/agent-sdk` and tool gateway endpoints.                                                                             |

---

## 4. Running Browser E2E Tests

AEGIS includes comprehensive Playwright browser tests covering layout, filtering, authorization dialogs, input validation, and keyboard accessibility:

```bash
# Run all Playwright specs across Chromium, Firefox, and Mobile Viewport
npx playwright test --config=tests/e2e/playwright.config.ts
```
