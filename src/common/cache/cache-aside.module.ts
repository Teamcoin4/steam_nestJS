import { Global, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { CacheAsideService } from './cache-aside.service';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => ({
        store: await redisStore({
          url: cfg.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        }),
        ttl: 60_000,
      }),
    }),
  ],
  providers: [CacheAsideService],
  exports: [CacheModule, CacheAsideService],
})
export class CacheAsideModule {}
