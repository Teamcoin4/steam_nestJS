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
  @HttpCode(201)
  async login(@Body() loginDto: TestLoginDto) {
    const result = await this.steamOpenIdService.testLogin(loginDto.steamId);

    return {
      user: result.user,
      tokenType: 'Bearer',
      accessToken: result.accessToken,
      expiresIn: result.accessTokenExpiresIn,
    };
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
  async callback(@Query() query: Record<string, string>, @Res() res: Response) {
    const result = await this.steam.finalizeLogin(query);

    // refresh 쿠키 설정
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: result.refreshTokenMaxAgeMs,
      path: '/api/v1',
    });

    // 🔍 디버깅 로그 추가!
    console.log('🔍 전체 Query:', query);
    console.log('🔍 redirect 값:', query.redirect);
    console.log('🔍 redirect 타입:', typeof query.redirect);
    console.log('🔍 조건 체크 결과:', query.redirect === 'frontend');

    // 웹 브라우저에서 호출한 경우 프론트엔드로 리다이렉트
    if (query.redirect === 'frontend') {
      console.log('✅ 리다이렉트 실행!');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(
        `${frontendUrl}/auth/callback?token=${result.accessToken}`,
      );
    }

    console.log('❌ JSON 응답 실행');
    // 기존 API 응답
    return res.json({
      tokenType: 'Bearer',
      accessToken: result.accessToken,
      expiresIn: result.accessTokenExpiresIn,
      user: result.user,
    });
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
      secure: false,
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
