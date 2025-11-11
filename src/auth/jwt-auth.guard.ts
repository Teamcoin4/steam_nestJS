import {
  Injectable,
  Logger,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

/** 인증된 사용자 객체 구조 */
interface AuthUser {
  id: number;
  steamId: string;
}

/** req.user 타입 검증 함수 */
function isAuthUser(value: unknown): value is AuthUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'steamId' in value &&
    typeof (value as { id: unknown }).id === 'number' &&
    typeof (value as { steamId: unknown }).steamId === 'string'
  );
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt-access') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.logger.debug('🔥 JwtAuthGuard invoked in SteamController context');

    // 1️⃣ 기본 Passport 인증 수행
    const isAllowed = (await super.canActivate(context)) as boolean;
    this.logger.debug(`✅ super.canActivate result = ${isAllowed}`);

    // 2️⃣ Request 객체에서 user 정보 추출
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    this.logger.debug('👀 req.user after Passport =', req.user);

    const maybeUser = req.user;

    // 3️⃣ 유효성 검증
    if (!isAuthUser(maybeUser)) {
      this.logger.error('❌ Invalid or missing req.user:', maybeUser);
      throw new UnauthorizedException('Invalid JWT user payload');
    }

    // 4️⃣ 타입이 확정된 user 객체
    const user: AuthUser = maybeUser;
    req.user = user;

    this.logger.debug(
      `🎯 JWT authenticated successfully: userId=${user.id}, steamId=${user.steamId}`,
    );

    return isAllowed;
  }
}
