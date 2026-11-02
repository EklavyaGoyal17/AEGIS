/*
 * Example: the TRUSTED side. A tool gateway that owns the CRM credentials and executes exports only with a
 * valid, single-use execution authorization bound to exactly these arguments.
 */
import { createPublicKey } from 'node:crypto';
import { createServer } from 'node:http';
import { AegisExecutionRejectedError } from '@aegis/agent-sdk';
import { createEnforcementPoint, InMemoryReplayStore } from '@aegis/agent-sdk/enforcement';

const gateway = createEnforcementPoint({
  audience: 'crm-tool-gateway',
  // Public keys come from configuration, keyed by kid. Never fetch keys named by the token.
  keys: new Map([['ea-key-2026-11', createPublicKey(process.env['AEGIS_EA_PUBLIC_KEY_PEM'] ?? '')]]),
  // Single instance only. With more than one replica use a shared atomic store (Redis SET NX EX).
  replayStore: new InMemoryReplayStore(),
  isRevoked: async (claims) => revokedAgents.has(claims.sub),
});
const revokedAgents = new Set<string>();

/** Placeholder for mTLS / workload identity of the calling agent runtime. */
function authenticateCaller(req: import('node:http').IncomingMessage): { tenantId: string; agentId: string } {
  const id = req.headers['x-spiffe-id'];
  if (typeof id !== 'string') throw new Error('unauthenticated');
  const [, tenantId, agentId] = id.split('/');
  return { tenantId: tenantId!, agentId: agentId! };
}

createServer(async (req, res) => {
  try {
    const caller = authenticateCaller(req);
    let body = '';
    for await (const chunk of req) body += chunk;
    const args = JSON.parse(body) as { table: string; destination: string; limit: number };
    const result = await gateway.execute(
      {
        token: req.headers['x-aegis-authorization'],
        tenantId: caller.tenantId,
        agentId: caller.agentId,
        action: 'crm.customers.export',
        resource: { type: 'crm.customer_table', id: args.table },
        args,
      },
      async (verified) => crmExport(verified), // runs with the verified, frozen arguments only
    );
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (err) {
    const status = err instanceof AegisExecutionRejectedError ? 403 : 400;
    res.writeHead(status).end();
  }
}).listen(8443);

async function crmExport(args: Readonly<{ table: string; destination: string; limit: number }>) {
  // Resolve the CRM credential here (CredentialReference → secret manager); never hand it to the agent.
  return { started: true, records: args.limit };
}
