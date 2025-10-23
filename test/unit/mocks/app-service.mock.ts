import { AppService } from 'src/app.service';
import { createMock } from '../utils/create-mock';

/**
 * Strict ESLint + 타입 안전 AppService Mock
 * - createMock<T>() 사용
 */
export function createAppServiceMock(): AppService {
  return createMock<AppService>();
}
