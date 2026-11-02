import { startTelemetry } from '../../../infra/telemetry.js';
const telemetry = startTelemetry();
const { startServer } = await import('../../api/src/runtime.js');
await startServer('gateway');
process.once('beforeExit', () => {
  void telemetry.shutdown();
});
