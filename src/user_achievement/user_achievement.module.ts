import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAchievement } from '../domain/achievements/user-achievement.entity';
import { User } from '../domain/users/user.entity';
import { Game } from '../domain/games/game.entity';
import { Achievement } from '../domain/achievements/achievement.entity';
import { Friend } from '../domain/friends/friends.entity';
import { UserAchievementController } from './user_achievement.controller';
import { UserAchievementService } from './user_achievement.service';
import { ExceptionModule } from '../common/exceptions/exception.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserAchievement,
      User,
      Game,
      Achievement,
      Friend,
    ]),
    ExceptionModule,
  ],
  controllers: [UserAchievementController],
  providers: [UserAchievementService],
  exports: [UserAchievementService],
})
export class UserAchievementModule {
  /* 공백오류 */
}
