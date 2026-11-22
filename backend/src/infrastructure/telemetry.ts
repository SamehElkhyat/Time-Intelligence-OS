import { Env } from '@/config/env';

/**
 * OpenTelemetry tracing. Enabled only when OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise this
 * is a no-op and the OpenTelemetry packages are never loaded. The packages are optional
 * dependencies, so a missing install degrades to "no tracing", not a crash.
 */
export async function startTelemetry(env: Env): Promise<void> {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
    const { ExpressInstrumentation } = await import('@opentelemetry/instrumentation-express');
    const { NestInstrumentation } = await import('@opentelemetry/instrumentation-nestjs-core');
    const sdk = new NodeSDK({
      serviceName: env.OTEL_SERVICE_NAME,
      traceExporter: new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces` }),
      instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation(), new NestInstrumentation()],
    });
    sdk.start();
    process.once('SIGTERM', () => void sdk.shutdown());
  } catch (err) {
    console.warn(`OpenTelemetry could not start: ${err instanceof Error ? err.message : String(err)}`);
  }
}
