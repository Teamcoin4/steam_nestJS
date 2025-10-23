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
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { SteamOpenIdService } from './steam-openid.service';
import { UpsertService } from '../api/upsert.service';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

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
  async start(@Res() res: Response) {
    const url = await this.steam.buildRedirectUrl();
    return res.redirect(url);
  }

  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = await this.steam.finalizeLogin(query);
    if (!isSteamCallbackResult(raw)) {
      throw new UnauthorizedException('Invalid steam callback response');
    }

    const user = raw.user;
    const cacheKey = `user:${user.id}`;
    await this.cacheManager.set(cacheKey, user, 3600);
    const cached = await this.cacheManager.get(cacheKey);
    console.log(`✅ [CACHE] User cached (${cacheKey}):`, !!cached);

    if (raw.steamId64 && user?.id) {
      console.log(
        `[auth] trigger syncUserAll steamId64=${raw.steamId64} userId=${user.id}`,
      );
      this.upsert
        .syncUserAll(raw.steamId64, user.id)
        .then(() => console.log('[auth] syncUserAll done'))
        .catch((err) => console.error('[auth] syncUserAll failed:', err));
    }

    // 🔥 1) 예전 경로(/api/v1)에 있던 동명이 쿠키 제거
    res.cookie('refresh_token', '', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 0,
      path: '/api/v1',
    });

    // ✅ 2) 새 쿠키는 루트 경로로만 세팅
    res.cookie('refresh_token', raw.refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: raw.refreshTokenMaxAgeMs,
      path: '/',
    });

    if (query.redirect === 'frontend') {
      const frontend =
        this.config.get<string>('FRONTEND_BASE_URL') ?? 'http://localhost:3001';
      console.log(`[auth] redirecting to ${frontend}/dashboard/me`);
      return res.redirect(`${frontend}/dashboard/me`);
    }

    return {
      tokenType: 'Bearer',
      accessToken: raw.accessToken,
      expiresIn: raw.accessTokenExpiresIn,
      user,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = getCookie(req, 'refresh_token');
    console.log('[refresh] received cookie:', token ? '✅ exists' : '❌ none');
    if (!token) throw new UnauthorizedException('no refresh cookie');

    try {
      const raw = await this.steam.rotateRefreshToken(token);
      if (!isRefreshRotateResult(raw)) {
        throw new UnauthorizedException('Invalid refresh response');
      }

      // 🔥 1) 예전 경로(/api/v1)의 쿠키 제거
      res.cookie('refresh_token', '', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 0,
        path: '/api/v1',
      });

      // ✅ 2) 갱신 쿠키는 루트 경로
      res.cookie('refresh_token', raw.refreshToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: raw.refreshTokenMaxAgeMs,
        path: '/',
      });

      console.log('[refresh] rotated -> access ok, new refresh cookie set');
      return { tokenType: 'Bearer', accessToken: raw.accessToken };
    } catch (e) {
      console.error('[refresh] rotate failed:', e);
      throw e;
    }
  }
}
