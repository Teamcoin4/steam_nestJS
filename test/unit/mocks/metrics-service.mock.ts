import { MetricsService } from 'src/common/metrics/metrics.service';
import { createMock } from '../utils/create-mock';

/**
 * Strict ESLint 호환 버전의 MetricsService Mock
 * - prom-client 필드는 테스트에 필요 없으므로 굳이 정의하지 않음
 * - createMock<T>() 사용 → 모든 public 메서드는 jest.fn() 자동 생성됨
 * - 컨트롤러 테스트에서는 메서드 호출 여부만 검증하면 충분
 */
export function createMetricsServiceMock(): MetricsService {
  return createMock<MetricsService>();
}
