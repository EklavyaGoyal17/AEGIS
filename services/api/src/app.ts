import Fastify from 'fastify';
export function buildApp() {
  const app = Fastify({
    logger: false,
    requestTimeout: 15000,
    bodyLimit: 65536,
  });
  app.get('/v1/health', async () => ({ status: 'ok' }));
  return app;
}
