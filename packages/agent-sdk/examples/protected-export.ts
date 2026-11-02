/*
 * Example: an agent tool wrapper that asks AEGIS before exporting customer records.
 *
 * The agent process only obtains a decision and an opaque execution authorization. The export itself is
 * performed by the CRM tool gateway (see ./tool-gateway.ts), which holds the CRM credentials and verifies
 * the authorization. An agent that skips this wrapper simply has no way to reach the CRM.
 */
import {
  AegisApprovalRequiredError,
  AegisClient,
  AegisDeniedError,
  AegisError,
  AegisGuard,
  jsonLogger,
  type CredentialProvider,
} from '@aegis/agent-sdk';

// Inject credentials; e.g. a workload-identity token exchanged for a short-lived AEGIS token.
const credentials: CredentialProvider = {
  async getToken(signal) {
    const res = await fetch('http://127.0.0.1:8200/v1/aegis/token', { signal }); // local token broker
    if (!res.ok) throw new Error('token broker unavailable');
    return ((await res.json()) as { token: string }).token;
  },
};

const client = new AegisClient({
  baseUrl: process.env['AEGIS_URL'] ?? 'https://aegis.example.com',
  credentials,
  timeoutMs: 3000,
  deadlineMs: 8000,
  logger: jsonLogger,
});
const guard = new AegisGuard(client);

export interface ExportArgs {
  table: string;
  destination: string;
  limit: number;
}

/** Tool exposed to the model. Its return value is what the model sees. */
export async function exportCustomers(args: ExportArgs, approvalId?: string): Promise<string> {
  try {
    return await guard.execute(
      {
        agentId: 'agent-crm',
        action: 'crm.customers.export',
        resource: {
          type: 'crm.customer_table',
          id: args.table,
          attributes: { recordCount: args.limit, destination: args.destination.startsWith('internal://') ? 'internal' : 'external' },
        },
        args,
        ...(approvalId ? { approvalId } : {}),
      },
      async ({ executionAuthorization, args: authorized }) => {
        // Send the exact authorized args plus the opaque token to the trusted gateway.
        const res = await fetch('https://crm-gateway.internal/export', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-aegis-authorization': executionAuthorization!.token },
          body: JSON.stringify(authorized),
        });
        if (!res.ok) throw new Error(`gateway refused: ${res.status}`);
        return `Export started (${authorized.limit} records).`;
      },
    );
  } catch (err) {
    // Tell the model what happened; never retry around a denial or an approval requirement.
    if (err instanceof AegisApprovalRequiredError) {
      return `This export needs human approval (request ${err.approvalId}). Ask the user to approve it in AEGIS, then retry with that id.`;
    }
    if (err instanceof AegisDeniedError) return `Export not permitted (${err.decision.reasonCodes.join(', ')}).`;
    if (err instanceof AegisError) return 'Authorization service unavailable; the export was not performed.';
    throw err;
  }
}
