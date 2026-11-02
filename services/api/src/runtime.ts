import pg from 'pg';
import { z } from 'zod';
import { buildApp } from './app.js';
import { Store } from './store.js';
import { Authorization } from './authorization.js';
import { identityFromEnv } from './identity.js';
import { UnavailablePolicyEngine, type PolicyEngine } from './domain.js';
import { maintenance } from './maintenance.js';
import { DemoNoteAdapter, Gateway } from '../../gateway/src/gateway.js';
import { canonicalPolicyEngine } from './canonical-engine.js';

export async function startServer(surface: 'api' | 'gateway') {
  const databaseUrl = z.string().url().parse(process.env.DATABASE_URL);
  const cursorKey = z.string().min(32).parse(process.env.CURSOR_SIGNING_KEY);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 20,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    idleTimeoutMillis: 30000,
    application_name: `aegis-${surface}`,
  });
  pool.on('error', () => {
    process.stderr.write('Database pool connection lost\n');
  });
  let engine: PolicyEngine = new UnavailablePolicyEngine();
  const store = new Store(pool);
  if (
    process.env.ENABLE_LOCAL_DEMO_POLICY !== 'true' &&
    !process.env.AEGIS_POLICY_ADAPTER_MODULE
  ) {
    // The canonical engine ships in this repository; failing to load it is a deployment error and
    // stops startup instead of silently serving an always-deny engine.
    const specifier =
      process.env.AEGIS_CANONICAL_ENGINE_MODULE ?? '@aegis/policy-engine';
    engine = await canonicalPolicyEngine(store, specifier);
  }
  if (process.env.ENABLE_LOCAL_DEMO_POLICY === 'true') {
    const { LocalDemoFixture } =
      await import('../../../infra/local-demo-policy.js');
    engine = new LocalDemoFixture();
  }
  // The production engine integration is explicit; absence never selects the demo fixture.
  if (process.env.AEGIS_POLICY_ADAPTER_MODULE) {
    if (process.env.ENABLE_LOCAL_DEMO_POLICY === 'true')
      throw new Error('Choose one policy adapter');
    const module = await import(process.env.AEGIS_POLICY_ADAPTER_MODULE);
    engine = await module.createPolicyAdapter();
    if (
      !engine ||
      typeof engine.evaluate !== 'function' ||
      typeof engine.validatePolicy !== 'function'
    )
      throw new Error('Invalid policy adapter module');
  }
  const authorization = new Authorization(store, engine);
  const identity = await identityFromEnv();
  const gateway =
    surface === 'gateway'
      ? new Gateway(
          authorization,
          new DemoNoteAdapter(
            z.string().parse(process.env.DEMO_TOOL_ORIGIN),
            z.string().min(32).parse(process.env.DEMO_TOOL_SECRET),
            process.env.NODE_ENV !== 'production',
          ),
        )
      : undefined;
  const app = buildApp({
    authorization,
    identity,
    surface,
    logger: true,
    cursorKey,
    ...(gateway ? { gateway } : {}),
  });
  let stopping = false;
  let activeMaintenance: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (stopping || activeMaintenance) return;
    activeMaintenance = maintenance(authorization)
      .catch(() => {
        app.log.error({ code: 'MAINTENANCE_FAILED' }, 'Recovery failed');
      })
      .finally(() => {
        activeMaintenance = undefined;
      });
  }, 10000);
  timer.unref();
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const deadline = setTimeout(() => {
      process.exitCode = 1;
      process.exit(1);
    }, 15000);
    deadline.unref();
    try {
      await app.close();
      await activeMaintenance;
      await pool.end();
    } finally {
      clearTimeout(deadline);
    }
  }
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      void shutdown();
    });
  app.addHook('onClose', async () => {
    stopping = true;
    clearInterval(timer);
  });
  await app.listen({
    host: process.env.HOST ?? '127.0.0.1',
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(process.env.PORT ?? (surface === 'api' ? 3000 : 3001)),
  });
  return { app, shutdown };
}
