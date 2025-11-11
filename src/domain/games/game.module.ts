// src/domain/games/game.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game } from './game.entity';
import { OwnedGame } from './owned-game.entity';
import { Achievement } from '../achievements/achievement.entity';
import { UserAchievement } from '../achievements/user-achievement.entity';
import { OwnedGameRepository } from './owned-game.repository';
import { AchievementRepository } from '../achievements/achievement.repository';
import { UserAchievementRepository } from '../achievements/user-achievement.repository';
import { UserSummaryRepository } from '../users/user-summary.repository';
import { UsersModule } from '../users/users.module';
import { ApiModule } from '../../api/api.module';
import { GameService } from './game.service';
import { GameController } from './game.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Game, OwnedGame, Achievement, UserAchievement]),
    UsersModule,
    forwardRef(() => ApiModule),
  ],
  controllers: [GameController],
  providers: [
    OwnedGameRepository,
    AchievementRepository,
    UserAchievementRepository,
    UserSummaryRepository,
    GameService,
  ],
  exports: [
    OwnedGameRepository,
    AchievementRepository,
    UserAchievementRepository,
    UserSummaryRepository,
  ],
})
export class GameModule {}
