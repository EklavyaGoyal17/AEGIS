import { expect, test } from 'vitest';
import { buildApp } from '../src/app.js';
test('health is available without authentication', async () => {
  const app = buildApp();
  try {
    expect((await app.inject('/v1/health')).json()).toMatchObject({
      status: 'ok',
      apiVersion: '1.0.0',
    });
  } finally {
    await app.close();
  }
});
