import { Module, Global } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
        config: {
          prefix: 'steam_app_',
        },
      },
      path: '/metrics',
      defaultLabels: {
        app: 'steam-nestjs',
      },
    }),
  ],
  providers: [
    makeCounterProvider({
      name: 'steam_app_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    }),
    makeHistogramProvider({
      name: 'steam_app_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    }),
    makeGaugeProvider({
      name: 'steam_app_active_connections',
      help: 'Number of active connections',
    }),
    makeCounterProvider({
      name: 'steam_app_errors_total',
      help: 'Total number of errors',
      labelNames: ['type', 'route'],
    }),
    MetricsService,
    MetricsInterceptor,
  ],
  exports: [MetricsService, MetricsInterceptor],
})
export class MetricsModule {}
