import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from 'src/domain/users/users.module';
import { RedisModule } from 'src/infra/redis/redis.module';
import { SteamAuthController } from './auth.controller';
import { SteamOpenIdService } from './steam-openid.service';
import { JwtAccessStrategy } from './jwt-access.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { MeModule } from 'src/me/me.module';
import { GameDomainModule } from 'src/domain/games/game.module';
import { FriendsModule } from '../domain/friends/friends.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt-access' }), // 🔥 추가
    UsersModule,
    RedisModule,
    JwtModule.register({}), // 기존 그대로 유지
    MeModule,
    GameDomainModule,
    forwardRef(() => FriendsModule),
  ],
  controllers: [SteamAuthController],
  providers: [
    SteamOpenIdService,
    JwtAccessStrategy,
    JwtAuthGuard, //  추가
  ],
  exports: [
    SteamOpenIdService,
    JwtAuthGuard, //  추가
    PassportModule, //  추가
  ],
})
export class AuthModule {}
