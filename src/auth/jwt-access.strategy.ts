import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../domain/users/user.entity';

type AccessPayload = {
  sub?: number;
  id?: number;
  typ?: string;
  steamId?: number | string; // 과거 토큰 호환
};

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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: cfg.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AccessPayload) {
    console.log('[JWT validate payload]', payload);
    const userId = Number.isSafeInteger(payload.sub)
      ? (payload.sub as number)
      : Number.isSafeInteger(payload.id)
        ? (payload.id as number)
        : undefined;

    if (!userId || (payload.typ && payload.typ !== 'access')) {
      throw new UnauthorizedException('Invalid accessToken');
    }

    // steamId를 string 정규화
    let steamId: string | undefined =
      typeof payload.steamId === 'string'
        ? payload.steamId
        : typeof payload.steamId === 'string'
          ? String(payload.steamId)
          : undefined;
    if (!steamId) {
      const u = await this.users.findOne({ where: { id: userId } });
      steamId = u?.steamId;
    }

    return { id: userId, steamId };
  }
}

// 기존코드
//   validate(payload: AccessPayload) {
//     if (
//       !Number.isSafeInteger(payload.sub) ||
//       (payload.typ && payload.typ !== 'access')
//     )
//       throw new UnauthorizedException('Invalid accessToken');

//     return { userId: payload.sub, steamId: payload.steamId };
//   }
// }
