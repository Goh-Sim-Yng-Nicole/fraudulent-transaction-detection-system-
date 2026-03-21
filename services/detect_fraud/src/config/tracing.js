'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

if ((process.env.OTEL_ENABLED || 'true').toLowerCase() !== 'true') {
  module.exports = null;
  return;
}

const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318';
const tracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || `${baseEndpoint.replace(/\/$/, '')}/v1/traces`;

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: tracesEndpoint,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

try {
  const started = sdk.start();
  if (started && typeof started.then === 'function') {
    started.then(() => {
      console.log(`[tracing] OpenTelemetry started (${tracesEndpoint})`);
    }).catch((err) => {
      console.error('[tracing] OpenTelemetry startup failed', err);
    });
  } else {
    console.log(`[tracing] OpenTelemetry started (${tracesEndpoint})`);
  }
} catch (err) {
  console.error('[tracing] OpenTelemetry startup failed', err);
}

const shutdownTelemetry = async () => {
  try {
    const result = sdk.shutdown();
    if (result && typeof result.then === 'function') {
      await result;
    }
  } catch (err) {
    console.error('[tracing] OpenTelemetry shutdown failed', err);
  }
};

process.on('SIGTERM', shutdownTelemetry);
process.on('SIGINT', shutdownTelemetry);

module.exports = sdk;
