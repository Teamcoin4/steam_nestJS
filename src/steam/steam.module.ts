// steam.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { SteamController } from '../api/steam.api.controller';
import { SteamApiService } from '../api/steam.api.service';
import { UpsertService } from '../api/upsert.service';
import { AuthModule } from '../auth/auth.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ApiModule } from '../api/api.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // ✅ 명시적 import
import { SteamSyncService } from 'src/api/steam-sync.service';
import { MeModule } from 'src/me/me.module';
import { GameModule } from 'src/domain/games/game.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => DashboardModule),
    forwardRef(() => MeModule),
    forwardRef(() => GameModule),
    ApiModule,
  ],
  controllers: [SteamController],
  providers: [SteamApiService, UpsertService, JwtAuthGuard, SteamSyncService], // ✅ 명시적으로 Guard 등록
  exports: [SteamApiService, SteamSyncService],
})
export class SteamModule {}
