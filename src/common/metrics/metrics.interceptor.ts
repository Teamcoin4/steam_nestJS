import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';
import { Request, Response } from 'express';

interface HttpError {
  status?: number;
  name?: string;
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const method: string = request.method;
    const route: string =
      (request.route as { path?: string } | undefined)?.path ||
      request.path ||
      'unknown';
    const startTime: number = Date.now();

    // 활성 연결 증가
    this.metricsService.incrementActiveConnections();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration: number = (Date.now() - startTime) / 1000;
          const statusCode: number = response.statusCode;

          // 메트릭 기록
          this.metricsService.incrementHttpRequests(method, route, statusCode);
          this.metricsService.observeHttpDuration(
            method,
            route,
            statusCode,
            duration,
          );

          // 활성 연결 감소
          this.metricsService.decrementActiveConnections();
        },
        error: (err: unknown) => {
          const duration: number = (Date.now() - startTime) / 1000;

          // 타입 가드로 안전하게 처리
          const error = err as HttpError;
          const statusCode: number =
            typeof error.status === 'number' ? error.status : 500;
          const errorName: string =
            typeof error.name === 'string' ? error.name : 'UnknownError';

          // 에러 메트릭 기록
          this.metricsService.incrementHttpRequests(method, route, statusCode);
          this.metricsService.observeHttpDuration(
            method,
            route,
            statusCode,
            duration,
          );
          this.metricsService.incrementErrors(errorName, route);

          // 활성 연결 감소
          this.metricsService.decrementActiveConnections();
        },
      }),
    );
  }
}
