import { Module, forwardRef } from '@nestjs/common';
import { CacheAsideModule } from 'src/common/cache/cache-aside.module';
import { GameModule } from 'src/domain/games/game.module';
import { UsersModule } from 'src/domain/users/users.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { SteamModule } from '../steam/steam.module';

@Module({
  imports: [
    forwardRef(() => SteamModule), // ✅ SteamSyncService 제공 모듈 import
    UsersModule,
    GameModule,
    CacheAsideModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: 60,
        },
      ],
    }),
  ],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
