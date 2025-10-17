export const monitoringConfig = {
  // Loki (로그)
  loki: {
    host: process.env.LOKI_HOST || 'http://localhost:3100',
    labels: {
      app: 'steam-nestjs',
      environment: process.env.NODE_ENV || 'development',
    },
  },

  // Prometheus (메트릭)
  prometheus: {
    defaultMetrics: {
      enabled: true,
      config: {
        prefix: 'steam_app_',
      },
    },
  },

  // Tempo (트레이싱)
  tempo: {
    endpoint: process.env.TEMPO_ENDPOINT || 'http://localhost:4318/v1/traces',
    serviceName: 'steam-nestjs-api',
    environment: process.env.NODE_ENV || 'development',
  },

  // AlertManager
  alertmanager: {
    enabled: process.env.ALERTMANAGER_ENABLED === 'true',
    url: process.env.ALERTMANAGER_URL || 'http://localhost:9093',
  },
};
