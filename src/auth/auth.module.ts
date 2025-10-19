import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { SteamAuthController } from './auth.controller';
import { JwtAccessStrategy } from './jwt-access.strategy';
import { SteamOpenIdService } from './steam-openid.service';

import { User } from '../domain/users/user.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';
import { UsersRepository } from '../domain/users/users.repository';
import { OwnedGameRepository } from '../domain/games/owned-game.repository';
import { SteamApiModule } from '../api/steam.api.module';
import { CacheAsideModule } from '../common/cache/cache-aside.module';
import { RedisModule } from '../infra/redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: cfg.get('JWT_EXPIRES_IN') ?? '15m',
        },
      }),
    }),
    TypeOrmModule.forFeature([User, OwnedGame]),
    SteamApiModule, // to inject UpsertService
    CacheAsideModule, // CACHE_MANAGER, CacheAsideService
    RedisModule, // REDIS 클라이언트
  ],
  controllers: [SteamAuthController],
  providers: [
    JwtAccessStrategy,
    SteamOpenIdService,
    UsersRepository,
    OwnedGameRepository,
  ],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}
