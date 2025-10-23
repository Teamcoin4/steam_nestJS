import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MetricsService } from './common/metrics/metrics.service';
import { createMetricsServiceMock } from '../test/unit/mocks/metrics-service.mock';
import { createAppServiceMock } from '../test/unit/mocks/app-service.mock';

describe('AppController (strict)', () => {
  let appController: AppController;
  let appService: jest.Mocked<AppService>;
  let metricsService: jest.Mocked<MetricsService>;

  beforeEach(() => {
    appService = createAppServiceMock() as jest.Mocked<AppService>;
    metricsService = createMetricsServiceMock() as jest.Mocked<MetricsService>;

    appService.getHello.mockReturnValue('Hello World!');

    // ✅ Nest DI 없이 단순 객체로 생성
    appController = new AppController(appService, metricsService);

    jest.clearAllMocks();
  });

  describe('getHello', () => {
    it('should return "Hello World!" and call incrementHttpRequests', () => {
      const result = appController.getHello();

      expect(result).toBe('Hello World!');
      expect(appService.getHello.mock.calls.length).toBe(1);
      expect(metricsService.incrementHttpRequests.mock.calls[0]).toEqual([
        'GET',
        '/api/v1',
        200,
      ]);
    });
  });

  describe('testMetrics', () => {
    it('should return "Metrics test OK!" and call relevant metrics', () => {
      const result = appController.testMetrics();

      expect(result).toBe('Metrics test OK!');
      expect(metricsService.incrementHttpRequests.mock.calls[0]).toEqual([
        'GET',
        '/api/v1/test-metrics',
        200,
      ]);
      expect(metricsService.incrementActiveConnections.mock.calls.length).toBe(
        1,
      );
    });
  });
});
