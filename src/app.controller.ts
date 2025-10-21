import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { MetricsService } from './common/metrics/metrics.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get()
  getHello(): string {
    // 메트릭 수동으로 증가
    this.metricsService.incrementHttpRequests('GET', '/api/v1', 200);
    return this.appService.getHello();
  }

  @Get('test-metrics')
  testMetrics(): string {
    // 테스트용 메트릭 생성
    this.metricsService.incrementHttpRequests(
      'GET',
      '/api/v1/test-metrics',
      200,
    );
    this.metricsService.incrementActiveConnections();
    return 'Metrics test OK!';
  }
}
