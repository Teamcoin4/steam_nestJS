import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { User } from '../domain/users/user.entity';

interface AccessPayload {
  sub?: number;
  id?: number;
  typ?: string;
  steamId?: number | string;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(
  Strategy,
  'jwt-access',
) {
  constructor(
    cfg: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request): string | null => {
          // ✅ 1. Authorization 헤더 우선
          const authHeader = req.headers.authorization;
          if (
            typeof authHeader === 'string' &&
            authHeader.startsWith('Bearer ')
          ) {
            return authHeader.slice(7);
          }

          // ✅ 2. 쿠키에 access_token이 있으면 사용
          const cookies = req.cookies as
            | Partial<Record<string, string>>
            | undefined;
          const tokenFromCookie = cookies?.access_token;
          if (typeof tokenFromCookie === 'string') {
            return tokenFromCookie;
          }

          return null;
        },
      ]),
      secretOrKey: cfg.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
      algorithms: ['HS256'],
    });
  }

  async validate(
    payload: AccessPayload,
  ): Promise<{ id: number; steamId?: string }> {
    console.log('[JWT validate payload]', payload);

    const userId =
      typeof payload.sub === 'number'
        ? payload.sub
        : typeof payload.id === 'number'
          ? payload.id
          : undefined;

    if (!userId || (payload.typ && payload.typ !== 'access')) {
      throw new UnauthorizedException('Invalid access token');
    }

    let steamId: string | undefined;

    if (typeof payload.steamId === 'string') {
      steamId = payload.steamId;
    } else if (typeof payload.steamId === 'number') {
      steamId = String(payload.steamId);
    } else {
      const user = await this.users.findOne({ where: { id: userId } });
      steamId = user?.steamId;
    }

    const result = { id: userId, steamId };
    console.log('[JWT validate return]', result);

    return result;
  }
}
