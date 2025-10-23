// src/auth/steam/steam-auth.controller.ts
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
  Body,
  BadRequestException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { SteamOpenIdService } from './steam-openid.service';
import { UpsertService } from '../api/upsert.service';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

interface TestLoginDto {
  steamId: string;
}

// ===== Runtime type guards to avoid any/unsafe =====
interface AuthUser {
  id: number;
  steamId: string;
  personaName: string | null;
  avatar: string | null;
}
interface AuthResult {
  user: AuthUser;
  accessToken: string;
  accessTokenExpiresIn: number; // seconds
  refreshToken: string;
  refreshTokenMaxAgeMs: number;
}
interface RefreshRotateResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenMaxAgeMs: number;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isAuthResult(v: unknown): v is AuthResult {
  return (
    isRecord(v) &&
    isRecord(v.user) &&
    typeof v.user.id === 'number' &&
    typeof v.user.steamId === 'string' &&
    typeof v.accessToken === 'string' &&
    typeof v.accessTokenExpiresIn === 'number' &&
    typeof v.refreshToken === 'string' &&
    typeof v.refreshTokenMaxAgeMs === 'number'
  );
}
function isRefreshRotateResult(v: unknown): v is RefreshRotateResult {
  return (
    isRecord(v) &&
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.refreshTokenMaxAgeMs === 'number'
  );
}
// ================================================

@Controller('auth')
export class AuthController {
  constructor(private readonly steamOpenIdService: SteamOpenIdService) {}

  @Post('login')
  @HttpCode(201)
  async login(@Body() loginDto: TestLoginDto): Promise<{
    user: AuthUser;
    tokenType: 'Bearer';
    accessToken: string;
    expiresIn: number;
  }> {
    const rawUnknown: unknown = await this.steamOpenIdService.testLogin(
      loginDto.steamId,
    );
    if (!isAuthResult(rawUnknown)) {
      throw new BadRequestException('Invalid auth result');
    }
    const raw = rawUnknown;

    return {
      user: raw.user,
      tokenType: 'Bearer' as const,
      accessToken: raw.accessToken,
      expiresIn: raw.accessTokenExpiresIn,
    };
  }
}

function getCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies;
  if (!cookies || typeof cookies !== 'object') return undefined;
  const val = (cookies as Record<string, string | undefined>)[name];
  return typeof val === 'string' ? val : undefined;
}

@Controller('auth/steam')
export class SteamAuthController {
  constructor(
    private readonly steam: SteamOpenIdService,
    private readonly upsert: UpsertService,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  @Get()
  async start(@Res() res: Response): Promise<void> {
    const url = await this.steam.buildRedirectUrl();
    res.redirect(url);
    return;
  }

  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const rawUnknown: unknown = await this.steam.finalizeLogin(query);
    if (!isAuthResult(rawUnknown)) {
      throw new UnauthorizedException('Invalid steam callback response');
    }
    const raw = rawUnknown;

    // 🔥 토큰 확인 로그 추가
    console.log(
      '🔑 생성된 accessToken:',
      raw.accessToken.substring(0, 50) + '...',
    );
    console.log('🔑 토큰 길이:', raw.accessToken.length);

    // refresh_token 쿠키 세팅
    res.cookie('refresh_token', raw.refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: raw.refreshTokenMaxAgeMs,
      path: '/api/v1',
    });
    // access_token도 쿠키로 세팅(가드에서 쿠키로 읽을 수 있게)
    res.cookie('access_token', raw.accessToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: raw.accessTokenExpiresIn * 1000,
      path: '/api/v1',
    });

    console.log('🔍 전체 Query:', query);
    console.log('🔍 redirect 값:', query.redirect);
    console.log('🔍 redirect 타입:', typeof query.redirect);
    console.log('🔍 조건 체크 결과:', query.redirect === 'frontend');

    if (query.redirect === 'frontend') {
      console.log('✅ 리다이렉트 실행!');
      const frontendUrl =
        this.config.get<string>('FRONTEND_BASE_URL') || 'http://localhost:3001';
      const redirectUrl = `${frontendUrl}/dashboard`;
      console.log('🔗 리다이렉트 URL:', redirectUrl.substring(0, 100) + '...'); // 🔥 추가
      res.redirect(redirectUrl);
      return;
    }

    res.json({
      tokenType: 'Bearer',
      accessToken: raw.accessToken,
      expiresIn: raw.accessTokenExpiresIn,
      user: raw.user,
    });
    return;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ tokenType: 'Bearer'; accessToken: string }> {
    const token = getCookie(req, 'refresh_token');
    console.log('[refresh] received cookie:', token ? '✅ exists' : '❌ none');
    if (!token) throw new UnauthorizedException('no refresh cookie');

    try {
      const rawUnknown: unknown = await this.steam.rotateRefreshToken(token);
      if (!isRefreshRotateResult(rawUnknown)) {
        throw new UnauthorizedException('Invalid refresh response');
      }
      const raw = rawUnknown;
      // 새 refresh_token 갱신 (API 경로로 제한)
      res.cookie('refresh_token', raw.refreshToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: raw.refreshTokenMaxAgeMs,
        path: '/api/v1',
      });
      // access_token도 갱신 쿠키로 설정(옵션)
      res.cookie('access_token', raw.accessToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000, // 서버 설정에 맞게 조정
        path: '/api/v1',
      });

      console.log('[refresh] rotated -> access ok, new refresh cookie set');
      return { tokenType: 'Bearer' as const, accessToken: raw.accessToken };
    } catch (e) {
      console.error('[refresh] rotate failed:', e);
      throw e;
    }
  }
}
