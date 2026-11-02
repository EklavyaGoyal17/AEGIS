import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test, vi } from 'vitest';
import { startTelemetry } from '../../../infra/telemetry.js';
import { buildApp } from '../src/app.js';

test('OTLP export includes HTTP route spans and excludes bearer credentials', async () => {
  const payloads: Buffer[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    payloads.push(Buffer.concat(chunks));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Test collector unavailable');
  vi.stubEnv(
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    `http://127.0.0.1:${address.port}/v1/traces`,
  );
  const telemetry = startTelemetry();
  const app = buildApp();
  try {
    await app.inject({
      url: '/v1/health',
      headers: { authorization: 'Bearer sensitive-test-credential' },
    });
    await app.close();
    await telemetry.shutdown();
    const output = Buffer.concat(payloads).toString('utf8');
    expect(payloads.length).toBeGreaterThan(0);
    expect(output).toContain('/v1/health');
    expect(output).not.toContain('sensitive-test-credential');
  } finally {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
