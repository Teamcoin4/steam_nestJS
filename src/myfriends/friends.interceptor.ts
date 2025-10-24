import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

// 단순 캐싱 메모리 저장소 (프로덕션에서는 Redis 추천)
const cacheStore = new Map<string, unknown>();

@Injectable()
export class FriendsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = `${request.user?.id ?? 'anon'}:${request.url}`;

    // 캐싱 확인
    if (cacheStore.has(key)) {
      return of(cacheStore.get(key));
    }

    const now = Date.now();
    return next.handle().pipe(
      tap((data: unknown) => {
        // 응답 캐싱 저장
        cacheStore.set(key, data);

        // 로깅
        console.log(
          `[FriendsInterceptor] ${request.method} ${request.url} - ${
            Date.now() - now
          }ms`,
        );
      }),
    );
  }
}
