// src/api/api.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// 🔹 Services & Controllers
import { SteamApiService } from './steam.api.service';
import { SteamSyncService } from './steam-sync.service';
import { UpsertService } from './upsert.service';
import { SteamController } from './steam.api.controller';
import { SteamSyncController } from './steam-sync.controller';

// 🔹 Entities
import { Game } from '../domain/games/game.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';
import { Achievement } from '../domain/achievements/achievement.entity';
import { UserAchievement } from '../domain/achievements/user-achievement.entity';
import { User } from '../domain/users/user.entity';
import { Friend } from '../domain/friends/friends.entity';

// 🔹 Other Modules
import { GameModule } from '../domain/games/game.module';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      OwnedGame,
      Achievement,
      UserAchievement,
      User,
      Friend,
    ]),
    forwardRef(() => GameModule),
    forwardRef(() => DashboardModule),
  ],
  controllers: [SteamController, SteamSyncController],
  providers: [SteamApiService, SteamSyncService, UpsertService],
  exports: [SteamApiService, SteamSyncService, UpsertService, TypeOrmModule],
})
export class ApiModule {}
