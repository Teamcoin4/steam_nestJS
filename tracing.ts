import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { monitoringConfig } from './src/config/monitoring.config';

if (process.env.ENABLE_TRACING === 'true') {
  const traceExporter = new OTLPTraceExporter({
    url: monitoringConfig.tempo.endpoint,
  });

  const sdk = new NodeSDK({
    serviceName: monitoringConfig.tempo.serviceName,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-express': {
          enabled: true,
        },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => console.log('Tracing terminated'))
      .catch((error: unknown) =>
        console.log('Error terminating tracing', error),
      )
      .finally(() => process.exit(0));
  });

  console.log('OpenTelemetry tracing enabled');
} else {
  console.log('OpenTelemetry tracing disabled');
}
