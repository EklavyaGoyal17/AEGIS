# AEGIS Demonstration Agent

A safe, self-contained AI-assisted customer support agent that demonstrates AEGIS policy gating, pre-execution evaluation, and human-in-the-loop review.

## Safety Guarantees
- **Synthetic Records Only**: Operates solely against in-memory synthetic ticket and customer fixtures in `src/synthetic-data.ts`.
- **Zero Real Credentials**: Never connects to production databases, payment systems, or external email providers.
- **Fail-Closed Gatekeeper**: Every simulated action queries the AEGIS Policy Gateway before executing.

## Demonstration Steps
1. **Read-only Action Allowed**: The agent reads a synthetic ticket (`customer-data/tickets/*`), which matches the `ALLOW` rule.
2. **Unauthorized Export Denied**: The agent attempts an export on `customer-data/pii/*`, which is rejected with `DENY`.
3. **Sensitive Modification Intercepted**: The agent attempts to alter a customer phone record (`customer-data/account/*`), which yields `REQUIRE_APPROVAL`.
4. **Human Review in Console**: The reviewer visits the AEGIS Console at `/approvals`, inspects the arguments, and approves or rejects the action.
5. **Gateway Outcome Enforced**: The downstream mutation only completes if the gatekeeper issues approval resolution.

## Running the Scenario
```bash
# In simulation mode (standalone)
npm run demo

# Against a live AEGIS backend
AEGIS_MODE=live AEGIS_GATEWAY_URL=http://localhost:3200 npm run demo
```
