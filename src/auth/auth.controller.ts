import {
  Controller,
  Get,
  Query,
  Res,
  Req,
  Post,
  UnauthorizedException,
  HttpCode,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { SteamOpenIdService } from './steam-openid.service';
import { Body } from '@nestjs/common';

interface TestLoginDto {
  steamId: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly steamOpenIdService: SteamOpenIdService) {}

  @Post('login')
  @HttpCode(201) // 테스트에서 기대하는 상태 코드
  async login(@Body() loginDto: TestLoginDto) {
    // testLogin 메서드 호출
    const result = await this.steamOpenIdService.testLogin(loginDto.steamId);

    // 테스트에서 기대하는 형식으로 반환
    return {
      user: result.user,
      tokenType: 'Bearer',
      accessToken: result.accessToken,
      expiresIn: result.accessTokenExpiresIn,
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
      secure: false,
    };

    res.clearCookie('refresh_token', cookieOpts);
    res.clearCookie('access_token', cookieOpts);
    return;
  }
}
function getCookie(req: Request, name: string): string | undefined {
  const anyReq = req as unknown as { cookies?: unknown };
  const { cookies } = anyReq;
  if (cookies && typeof cookies === 'object') {
    const val = (cookies as Record<string, unknown>)[name];
    if (typeof val === 'string') return val;
  }
  return undefined;
}
@Controller('auth/steam')
export class SteamAuthController {
  constructor(private readonly steam: SteamOpenIdService) {}

  // 스팀 로그인 페이지로 리다이렉트
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
    const result = await this.steam.finalizeLogin(query);

    const { refreshToken, refreshMaxAgeMs } = await this.steam.issueTokens(
      result.user.id,
      { refresh: true },
    );

    // refersh 쿠키 설정 (HttpOnly)
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: false, // 바꿔야함
      sameSite: 'lax',
      maxAge: refreshMaxAgeMs,
      path: '/api/v1',
    });

    const FRONT = process.env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3001';
    res.redirect(302, `${FRONT}/dashboard`);
    // body에는 accessToken만
  }

  @Post('token')
  async issueAccess(@Req() req: Request) {
    const rt = getCookie(req, 'refresh_token');
    if (!rt) return { error: 'NO_REFRESH' };

    const userId = await this.steam.verifyRefreshAndGetUser(rt);
    const { accessToken, accessExpSec } = await this.steam.issueTokens(userId, {
      access: true,
    });
    return { tokenType: 'Bearer', accessToken, expiresIn: accessExpSec };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = getCookie(req, 'refresh_token');
    if (!token) throw new UnauthorizedException('no refresh cookie');

    const out = await this.steam.rotateRefreshToken(token);

    res.cookie('refresh_token', out.refreshToken, {
      httpOnly: true,
      secure: false, // 바꿔야함
      sameSite: 'lax',
      maxAge: out.refreshTokenMaxAgeMs,
      path: '/api/v1',
    });

    return {
      tokenType: 'Bearer',
      accessToken: out.accessToken,
    };
  }
}
