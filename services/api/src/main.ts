import { buildApp } from './app.js';
const app = buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '127.0.0.1' });
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
