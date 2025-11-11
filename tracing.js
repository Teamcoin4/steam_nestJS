"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_node_1 = require("@opentelemetry/sdk-node");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const auto_instrumentations_node_1 = require("@opentelemetry/auto-instrumentations-node");
const monitoring_config_1 = require("./src/config/monitoring.config");
if (process.env.ENABLE_TRACING === 'true') {
    const traceExporter = new exporter_trace_otlp_http_1.OTLPTraceExporter({
        url: monitoring_config_1.monitoringConfig.tempo.endpoint,
    });
    const sdk = new sdk_node_1.NodeSDK({
        serviceName: monitoring_config_1.monitoringConfig.tempo.serviceName,
        traceExporter,
        instrumentations: [
            (0, auto_instrumentations_node_1.getNodeAutoInstrumentations)({
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
            .catch((error) => console.log('Error terminating tracing', error))
            .finally(() => process.exit(0));
    });
    console.log('OpenTelemetry tracing enabled');
}
else {
    console.log('OpenTelemetry tracing disabled');
}
//# sourceMappingURL=tracing.js.map