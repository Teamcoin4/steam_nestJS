import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Joi from 'joi';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';

// Controllers
import { AppController } from './app.controller';
import { AuthController } from './auth/auth.controller';
import { HealthController } from './infra/redis/redis-health.controller';
import { DashboardController } from './dashboard/dashboard.controller';
// import { UserAchievementController } from './user_achievement/user_achievement.controller';

// Services
import { AppService } from './app.service';
import { DashboardService } from './dashboard/dashboard.service';
// import { userAchievementService } from './user_achievement/user_achievement.service';

// Modules
import { SteamModule } from './integrations/steam/steam.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { UsersModule } from './domain/users/users.module';
import { GameDomainModule } from './domain/games/game.module';
import { AchievementsModule } from './domain/achievements/achievements.module';
import { RedisModule } from './infra/redis/redis.module';
import { CacheAsideModule } from './common/cache/cache-aside.module';
import { FriendsModule } from './domain/friends/friends.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UserAchievementModule } from './user_achievement/user_achievement.module';

// Entities
import { OwnedGame } from './domain/games/owned-game.entity';
import { Game } from './domain/games/game.entity';
import { User } from './domain/users/user.entity';
import { Achievement } from './domain/achievements/achievement.entity';
import { UserAchievement } from './domain/achievements/user-achievement.entity';
import { REDIS } from './infra/redis/redis.constants';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EtagInterceptor } from './common/interceptors/etag.interceptor';
import { Friend } from './domain/friends/friends.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('dev', 'prod', 'test').default('dev'),
        PORT: Joi.number().default(3000),
        STEAM_API_KEY: Joi.string().required(),
        STEAM_REALM: Joi.string().uri().required(),
        STEAM_RETURN_TO: Joi.string().uri().required(),
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('3d'),
        REDIS_URL: Joi.string().required(),
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        username: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        autoLoadEntities: true,
        synchronize: false,
        logging: process.env.TYPEORM_LOGGING === 'true',
        migrations: ['dist/migrations/*.js'],
        migrationsTransactionMode: 'each',
        entities: [OwnedGame, Game, User, Achievement, UserAchievement, Friend],
      }),
    }),
    TypeOrmModule.forFeature([User, OwnedGame, Game, Friend]),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService, REDIS],
      useFactory: async (cfg: ConfigService) => ({
        store: await redisStore({
          url: cfg.getOrThrow<string>('REDIS_URL'),
          ttl: 600,
        }),
      }),
    }),
    SteamModule,
    AuthModule,
    MeModule,
    UsersModule,
    AchievementsModule,
    GameDomainModule,
    RedisModule,
    CacheAsideModule,
    FriendsModule,
    DashboardModule,
    UserAchievementModule,
  ],
  controllers: [
    AppController,
    HealthController,
    AuthController,
    DashboardController,
  ],
  providers: [
    AppService,
    DashboardService,
    { provide: APP_INTERCEPTOR, useClass: EtagInterceptor },
  ],
})
export class AppModule {
  /* 공백오류 */
}
