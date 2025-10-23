import {
  Controller,
  Get,
  Query,
  Res,
  Req,
  Post,
  UnauthorizedException,
  HttpCode,
  Inject,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { SteamOpenIdService } from './steam-openid.service';
import { UpsertService } from '../api/upsert.service';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

// -------------------------
// 유효성 검사용 헬퍼 함수들
// -------------------------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// -------------------------
// 타입 정의
// -------------------------
interface SteamCallbackResult {
  user: {
    id: number;
    steamId: number;
    personaName: string | null;
    avatar: string | null;
  };
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenMaxAgeMs: number;
  steamId64?: string;
}
interface RefreshRotateResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenMaxAgeMs: number;
}

function isSteamCallbackResult(v: unknown): v is SteamCallbackResult {
  return (
    isRecord(v) &&
    isRecord(v.user) &&
    isString(v.accessToken) &&
    isNumber(v.accessTokenExpiresIn) &&
    isString(v.refreshToken) &&
    isNumber(v.refreshTokenMaxAgeMs)
  );
}
function isRefreshRotateResult(v: unknown): v is RefreshRotateResult {
  return (
    isRecord(v) &&
    isString(v.accessToken) &&
    isString(v.refreshToken) &&
    isNumber(v.refreshTokenMaxAgeMs)
  );
}

function getCookie(req: Request, name: string): string | undefined {
  const maybeCookies = (req as unknown as { cookies?: unknown }).cookies;
  if (isRecord(maybeCookies)) {
    const val = maybeCookies[name];
    return typeof val === 'string' ? val : undefined;
  }
  return undefined;
}

@Controller('auth/steam')
export class SteamAuthController {
  constructor(
    private readonly steam: SteamOpenIdService,
    private readonly upsert: UpsertService,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache, // ✅ 캐시 주입
  ) {}

  // -------------------------
  // 스팀 로그인 시작
  // -------------------------
  @Get()
  async start(@Res() res: Response) {
    const url = await this.steam.buildRedirectUrl();
    return res.redirect(url);
  }

  // -------------------------
  // 스팀 로그인 콜백
  // -------------------------
  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = await this.steam.finalizeLogin(query);
    if (!isSteamCallbackResult(raw)) {
      throw new UnauthorizedException('Invalid steam callback response');
    }

    // ✅ 캐시에 유저 정보 저장
    const user = raw.user;
    const cacheKey = `user:${user.id}`;
    await this.cacheManager.set(cacheKey, user, 3600); // 1시간 TTL
    const cached = await this.cacheManager.get(cacheKey);
    console.log(`✅ [CACHE] User cached (${cacheKey}):`, !!cached);
    console.log(
      `캐시 저장 확인:`,
      await this.cacheManager.get(`user:${user.id}`),
    );

    // 로그인 성공 후 비동기 동기화 트리거
    if (raw.steamId64 && user?.id) {
      console.log(
        `[auth] trigger syncUserAll steamId64=${raw.steamId64} userId=${user.id}`,
      );
      this.upsert
        .syncUserAll(raw.steamId64, user.id)
        .then(() => console.log('[auth] syncUserAll done'))
        .catch((err) => console.error('[auth] syncUserAll failed:', err));
    }

    // refresh 쿠키 설정
    res.cookie('refresh_token', raw.refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: raw.refreshTokenMaxAgeMs,
      path: '/api/v1',
    });

    // ✅ 프론트 리다이렉트
    if (query.redirect === 'frontend') {
      const frontend =
        this.config.get<string>('FRONTEND_BASE_URL') ?? 'http://localhost:3001';
      console.log(`[auth] redirecting to ${frontend}/dashboard/me`);
      return res.redirect(`${frontend}/dashboard/me`);
    }

    // ✅ 기본 응답
    return {
      tokenType: 'Bearer',
      accessToken: raw.accessToken,
      expiresIn: raw.accessTokenExpiresIn,
      user,
    };
  }

  // -------------------------
  // 리프레시 토큰 교체
  // -------------------------
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = getCookie(req, 'refresh_token');
    if (!token) throw new UnauthorizedException('no refresh cookie');

    const raw = await this.steam.rotateRefreshToken(token);
    if (!isRefreshRotateResult(raw)) {
      throw new UnauthorizedException('Invalid refresh response');
    }

    res.cookie('refresh_token', raw.refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: raw.refreshTokenMaxAgeMs,
      path: '/api/v1',
    });

    return { tokenType: 'Bearer', accessToken: raw.accessToken };
  }
}
