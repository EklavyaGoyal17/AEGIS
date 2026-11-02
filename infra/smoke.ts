import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { argumentsDigest } from '../services/api/src/domain.js';
const key = await importPKCS8(
  await readFile(
    new URL('../.backend-tmp/dev/private.pem', import.meta.url),
    'utf8',
  ),
  'RS256',
);
async function token(subject: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://identity.aegis.local.invalid')
    .setAudience('aegis-local')
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}
const machine = await token('demo-machine');
const human = await token('demo-human');
async function call(origin: string, path: string, jwt: string, body?: unknown) {
  const result = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${jwt}`,
      ...(body
        ? {
            'content-type': 'application/json',
            'idempotency-key': randomUUID(),
          }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await result.json();
  if (!result.ok)
    throw new Error(`Smoke failed (${result.status}): ${JSON.stringify(json)}`);
  return json;
}
const api = 'http://127.0.0.1:3000';
const gateway = 'http://127.0.0.1:3001';
const args = {
  text: 'A real note created through AEGIS trusted approval enforcement',
};
const request = {
  requestId: randomUUID(),
  agentId: 'demo-agent',
  action: 'demo.note.create',
  resource: { type: 'note', id: randomUUID(), attributes: {} },
  context: {},
  argumentsDigest: argumentsDigest(args),
};
const decision = await call(api, '/v1/decisions/evaluate', machine, request);
if (decision.effect !== 'REQUIRE_APPROVAL')
  throw new Error('Expected real pending approval');
const page = await call(api, '/v1/approvals?status=PENDING', human);
const approval = page.items.find(
  (item: { approvalId: string }) => item.approvalId === decision.approvalId,
);
if (!approval) throw new Error('Approval not listed');
const resolved = await call(
  api,
  `/v1/approvals/${approval.approvalId}/resolve`,
  human,
  { decision: 'APPROVE', expectedBindingDigest: approval.bindingDigest },
);
if (resolved.status !== 'APPROVED') throw new Error('Approval failed');
const input = { decisionId: decision.decisionId, request, arguments: args };
const executed = await call(gateway, '/internal/v1/executions', machine, input);
if (executed.state !== 'SUCCEEDED')
  throw new Error('Real adapter execution failed');
const duplicate = await call(
  gateway,
  '/internal/v1/executions',
  machine,
  input,
);
if (duplicate.executionId !== executed.executionId)
  throw new Error('Execution replay was not prevented');
console.log(
  JSON.stringify({
    decisionId: decision.decisionId,
    approvalId: decision.approvalId,
    executionId: executed.executionId,
    state: executed.state,
    duplicatePrevented: true,
  }),
);
