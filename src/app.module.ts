import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { SteamApiModule } from './api/steam.api.module';
import { AuthModule } from './auth/auth.module';

// Controllers
import { AppController } from './app.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { UserAchievementController } from './user_achievement/user_achievement.controller';

// Services
import { AppService } from './app.service';
import { DashboardService } from './dashboard/dashboard.service';
import { UserAchievementService } from './user_achievement/user_achievement.service';

// Modules
import { SteamModule } from './integrations/steam/steam.module';
import { MeModule } from './me/me.module';
import { UsersModule } from './domain/users/users.module';
import { GameDomainModule } from './domain/games/game.module';
import { AchievementsModule } from './domain/achievements/achievements.module';
import { CacheAsideModule } from './common/cache/cache-aside.module';
import { RedisModule } from './infra/redis/redis.module';
import { FriendsModule } from './domain/friends/friends.module';
import { ExceptionModule } from './common/exceptions/exception.module';

// Monitoring Modules - 추가
import { LoggerModule } from './common/logger/logger.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { MetricsInterceptor } from './common/metrics/metrics.interceptor';

// Entities
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EtagInterceptor } from './common/interceptors/etag.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER,
      password: process.env.DB_PASS ?? process.env.DB_PASSWORD ?? '',
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: false, // dev only
    }),
    // Monitoring Modules - 추가
    LoggerModule,
    MetricsModule,

    SteamModule,
    AuthModule,
    MeModule,
    UsersModule,
    FriendsModule,
    AchievementsModule,
    GameDomainModule,
    CacheAsideModule,
    RedisModule,
    SteamApiModule,
    ExceptionModule,
  ],
  controllers: [AppController, DashboardController, UserAchievementController],
  providers: [
    AppService,
    DashboardService,
    UserAchievementService,
    { provide: APP_INTERCEPTOR, useClass: EtagInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }, // 추가
  ],
})
export class AppModule {
  /* 공백오류 */
}
