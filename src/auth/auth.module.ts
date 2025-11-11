import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { UsersModule } from 'src/domain/users/users.module';
import { AuthController, SteamAuthController } from './auth.controller';
import { JwtAccessStrategy } from './jwt-access.strategy';
import { SteamOpenIdService } from './steam-openid.service';

import { User } from '../domain/users/user.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';
import { UsersRepository } from '../domain/users/users.repository';
import { CacheAsideModule } from '../common/cache/cache-aside.module';
import { RedisModule } from '../infra/redis/redis.module';
import { MeModule } from '../me/me.module';
import { GameModule } from '../domain/games/game.module';
import { FriendsModule } from 'src/domain/friends/friends.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiModule } from '../api/api.module';

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
    CacheAsideModule, // CACHE_MANAGER, CacheAsideService
    RedisModule, // REDIS 클라이언트
    UsersModule,
    RedisModule,
    MeModule,
    forwardRef(() => GameModule),
    ApiModule,
    forwardRef(() => FriendsModule),
  ],
  controllers: [SteamAuthController, AuthController],
  providers: [
    JwtAccessStrategy,
    SteamOpenIdService,
    UsersRepository,
    // OwnedGameRepository,
    JwtAuthGuard,
  ],
  exports: [
    JwtModule,
    PassportModule,
    SteamOpenIdService,
    JwtAuthGuard,
    PassportModule,
  ],
})
export class AuthModule {}
