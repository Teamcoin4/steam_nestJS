import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // ← 타입 단언 제거
      secretOrKey: cfg.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AccessPayload) {
    console.log('[JWT validate payload]', payload);

    const userId = Number.isSafeInteger(payload.sub)
      ? payload.sub
      : Number.isSafeInteger(payload.id)
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

    return { id: userId, steamId };
  }
}
