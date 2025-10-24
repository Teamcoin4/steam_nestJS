import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS } from './redis.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const url = cfg.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        const client = new Redis(url, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        client.on('error', (err) => console.error('Redis error', err));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
