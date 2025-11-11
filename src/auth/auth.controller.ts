import {
  Controller,
  Get,
  Query,
  Res,
  Req,
  Post,
  UnauthorizedException,
  HttpCode,
  Body,
  BadRequestException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { SteamOpenIdService } from './steam-openid.service';

/** -------- DTO & 런타임 가드 -------- */
interface TestLoginDto {
  steamId: string;
}

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
/** ---------------------------------- */

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
      expiresIn: raw.accessTokenExpiresIn, // seconds
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refresh = getCookie(req, 'refresh_token');
    if (refresh) {
      await this.steamOpenIdService.revokeRefreshToken(refresh);
    }

    const cookieOpts = {
      path: '/api/v1',
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: false, // TODO: prod에서 true
    };

    res.clearCookie('refresh_token', cookieOpts);
    res.clearCookie('access_token', cookieOpts);

    res.clearCookie('refresh_token', { ...cookieOpts, path: '/' });
    res.clearCookie('access_token', { ...cookieOpts, path: '/' });
    return;
  }
}

/** 안전한 쿠키 추출 */
function getCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies;
  if (!cookies || typeof cookies !== 'object') return undefined;
  const val = (cookies as Record<string, string | undefined>)[name];
  return typeof val === 'string' ? val : undefined;
}

@Controller('auth/steam')
export class SteamAuthController {
  constructor(private readonly steam: SteamOpenIdService) {}

  // 스팀 로그인 페이지로 리다이렉트
  @Get()
  async start(@Res() res: Response): Promise<void> {
    const url = await this.steam.buildRedirectUrl();
    res.redirect(url);
    return;
  }

  // 스팀 콜백
  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    // 1️⃣ Steam OpenID 검증 및 사용자 Upsert
    const { user } = await this.steam.finalizeLogin(query);

    // 2️⃣ Refresh Token 발급 → HttpOnly 쿠키로 저장
    const { refreshToken, refreshMaxAgeMs } = await this.steam.issueTokens(
      user.id,
      { refresh: true },
    );

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: false, // production에서는 true
      sameSite: 'lax',
      maxAge: refreshMaxAgeMs,
      path: '/api/v1',
    });

    // ✅ 3️⃣ 프론트엔드 콜백 페이지로 리다이렉트
    const FRONT = process.env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3001';
    res.redirect(302, `${FRONT}/auth/steam/callback`);
  }

  // refresh 쿠키로 access 토큰 발급
  @Post('token')
  async issueAccess(@Req() req: Request) {
    const rt = getCookie(req, 'refresh_token');
    if (!rt) return { error: 'NO_REFRESH' };

    const userId = await this.steam.verifyRefreshAndGetUser(rt);
    const { accessToken, accessExpSec } = await this.steam.issueTokens(userId, {
      access: true,
    });
    return { tokenType: 'Bearer', accessToken, expiresIn: accessExpSec }; // seconds
  }

  // refresh 회전(rotate) + 새 access 반환
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ tokenType: 'Bearer'; accessToken: string }> {
    const token = getCookie(req, 'refresh_token');
    if (!token) throw new UnauthorizedException('no refresh cookie');

    const rawUnknown: unknown = await this.steam.rotateRefreshToken(token);
    if (!isRefreshRotateResult(rawUnknown)) {
      throw new UnauthorizedException('Invalid refresh response');
    }
    const raw = rawUnknown;

    // 새 refresh_token 갱신 (API 경로로 제한)
    res.cookie('refresh_token', raw.refreshToken, {
      httpOnly: true,
      secure: false, // TODO: prod에서 true
      sameSite: 'lax',
      maxAge: raw.refreshTokenMaxAgeMs,
      path: '/api/v1',
    });

    // (선택) access_token도 쿠키로 설정
    res.cookie('access_token', raw.accessToken, {
      httpOnly: true,
      secure: false, // TODO: prod에서 true
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000, // 서버 설정에 맞게 조정
      path: '/api/v1',
    });

    return { tokenType: 'Bearer' as const, accessToken: raw.accessToken };
  }
}
