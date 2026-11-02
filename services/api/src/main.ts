import { startTelemetry } from '../../../infra/telemetry.js';
const telemetry = startTelemetry();
const { startServer } = await import('./runtime.js');
await startServer('api');
process.once('beforeExit', () => {
  void telemetry.shutdown();
});
