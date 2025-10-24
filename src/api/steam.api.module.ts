import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SteamApiService } from './steam.api.service';
import { UpsertService } from './upsert.service';
import { Game } from '../domain/games/game.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';
import { Achievement } from '../domain/achievements/achievement.entity';
import { UserAchievement } from '../domain/achievements/user-achievement.entity';
import { User } from '../domain/users/user.entity';
import { Friend } from '../domain/friends/friends.entity';
import { SteamController } from './steam.api.controller';

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
  ],
  providers: [SteamApiService, UpsertService],
  controllers: [SteamController],
  exports: [UpsertService, SteamApiService, TypeOrmModule],
})
export class SteamApiModule {}
