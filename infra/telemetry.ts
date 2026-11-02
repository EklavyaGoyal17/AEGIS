import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
export function startTelemetry() {
  if (!process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
    return { shutdown: async () => {} };
  const endpoint = new URL(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (
    !['https:', 'http:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error('Invalid OTLP endpoint');
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: endpoint.href,
      timeoutMillis: 2000,
    }),
  });
  sdk.start();
  return sdk;
}
