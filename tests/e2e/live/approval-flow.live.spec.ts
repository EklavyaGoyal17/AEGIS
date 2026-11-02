import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { importPKCS8, SignJWT } from 'jose';
import { computeArgumentsDigest } from '@aegis/contracts/crypto';

// Everything here hits the real API and gateway; nothing is mocked.
const API = process.env.AEGIS_API_URL ?? 'http://127.0.0.1:3000';
const GATEWAY = process.env.AEGIS_GATEWAY_URL ?? 'http://127.0.0.1:3001';
const keyPem = readFileSync(
  fileURLToPath(
    new URL('../../../.backend-tmp/dev/private.pem', import.meta.url),
  ),
  'utf8',
);

async function token(subject: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://identity.aegis.local.invalid')
    .setAudience('aegis-local')
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(await importPKCS8(keyPem, 'RS256'));
}

async function post(
  origin: string,
  path: string,
  subject: string,
  body: unknown,
) {
  const res = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await token(subject)}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

test('a human approves a real agent request in the console and the gateway then executes it once', async ({
  page,
}) => {
  const args = { text: `live e2e ${randomUUID()}` };
  const noteId = `e2e-${randomUUID().slice(0, 8)}`;
  const request = {
    requestId: randomUUID(),
    agentId: 'demo-agent',
    action: 'demo.note.create',
    resource: { type: 'note', id: noteId, attributes: {} },
    context: {},
    argumentsDigest: computeArgumentsDigest(args),
  };
  const decision = await post(
    API,
    '/v1/decisions/evaluate',
    'demo-machine',
    request,
  );
  expect(decision.json.effect).toBe('REQUIRE_APPROVAL');
  const execute = () =>
    post(GATEWAY, '/internal/v1/executions', 'demo-machine', {
      decisionId: decision.json.decisionId,
      request,
      arguments: args,
    });
  expect((await execute()).status).toBe(403); // not yet approved

  await page.goto('/approvals');
  await expect(page.getByTestId('data-source')).toHaveText('Live API');
  const card = page
    .locator('div', { hasText: `note/${noteId}` })
    .filter({
      has: page.getByRole('button', { name: /Authorize & Release/i }),
    })
    .last();
  await card.getByRole('button', { name: /Authorize & Release/i }).click();
  await page.getByPlaceholder(/audit trail reason/i).fill('Live E2E approval');
  const resolved = page.waitForResponse(
    (r) =>
      r
        .url()
        .includes(
          `/api/v1/approvals/${String(decision.json.approvalId)}/resolve`,
        ) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Confirm Authorization/i }).click();
  expect((await resolved).status()).toBe(200);

  const executed = await execute();
  expect(executed.status).toBe(200);
  expect(executed.json.state).toBe('SUCCEEDED');
  const replay = await execute();
  expect(replay.json.executionId).toBe(executed.json.executionId);
});

test('the console cannot be used cross-site to change policy', async ({
  request,
}) => {
  const res = await request.post('/api/v1/policies', {
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/json',
    },
    data: {},
  });
  expect(res.status()).toBe(403);
});
