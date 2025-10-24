import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Achievement } from './achievement.entity';
import { UserAchievement } from './user-achievement.entity';
import { AchievementService } from '../../achievement/achievement.service';
import { AchievementController } from '../../achievement/achievement.controller';
import { AchievementRepository } from '../../achievement/achievement.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Achievement, UserAchievement])],
  exports: [TypeOrmModule],
  providers: [AchievementService, AchievementRepository],
  controllers: [AchievementController],
})
export class AchievementsModule {
  /* 공백 오류 */
}
