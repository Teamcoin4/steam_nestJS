import { Module, Global } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';
import { monitoringConfig } from '../../config/monitoring.config';

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: monitoringConfig.prometheus.defaultMetrics,
      path: '/metrics',
      defaultLabels: {
        app: 'steam-nestjs',
      },
    }),
  ],
  providers: [MetricsService, MetricsInterceptor],
  exports: [MetricsService, MetricsInterceptor],
})
export class MetricsModule {}
