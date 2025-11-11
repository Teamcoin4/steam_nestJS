import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Achievement } from '../achievements/achievement.entity';
import { Game } from './game.entity';
import { UserAchievement } from '../achievements/user-achievement.entity';
import { AchievementDto } from '../../dto/achievement.dto';
import { GameDetailDto } from 'src/dto/game-detail.dto';

@Injectable()
export class GameService {
  constructor(
    @InjectRepository(Game)
    private readonly gameRepo: Repository<Game>,
    @InjectRepository(Achievement)
    private readonly achievementRepo: Repository<Achievement>,
    @InjectRepository(UserAchievement)
    private readonly userAchRepo: Repository<UserAchievement>,
  ) {}

  /** 🎯 전체 업적 + 유저 달성 정보 포함 조회 */
  async getAchievementsWithUserStatus(
    appId: number,
    userId: number,
  ): Promise<GameDetailDto> {
    // 🔹 1. 게임 정보 조회
    const game = await this.gameRepo.findOne({ where: { gameId: appId } });
    if (!game) {
      throw new NotFoundException(`AppID ${appId} 게임을 찾을 수 없습니다.`);
    }

    // 🔹 2. 전체 업적 조회
    const achievements = await this.achievementRepo.find({
      where: { gameId: game.gameId },
      order: { id: 'ASC' },
    });

    // 🔹 3. 유저 업적 상태 조회
    const userAchievements = await this.userAchRepo.find({
      where: { userId },
      relations: ['achievement'],
    });

    // 🔹 4. 빠른 조회용 Map 구성
    const achievedMap = new Map<
      number,
      { achieved: boolean; unlockedAt?: Date }
    >();
    userAchievements.forEach((ua) => {
      if (ua.achievement?.id) {
        achievedMap.set(ua.achievement.id, {
          achieved: ua.achieved ?? false,
          unlockedAt: (ua as Partial<{ unlockedAt?: Date }>).unlockedAt,
        });
      }
    });

    // 🔹 5. 업적 병합
    const achievementDtos: AchievementDto[] = achievements.map((a) => {
      const ua = achievedMap.get(a.id);
      return {
        id: a.id,
        gameId: a.gameId,
        apiName: a.apiName,
        name: a.displayName,
        description: a.description ?? undefined,
        hidden: a.hidden,
        icon: ua?.achieved
          ? (a.icon ?? a.iconGray ?? undefined)
          : (a.iconGray ?? a.icon ?? undefined),
        achieved: ua?.achieved ?? false, // ✅ 유저 달성 여부
        unlockedAt: ua?.unlockedAt
          ? new Date(ua.unlockedAt).toISOString()
          : null, // ✅ 달성일
        created_at: a.created_at,
        updated_at: a.updated_at,
      };
    });

    // 🔹 6. 결과 반환
    return {
      game: {
        gameId: game.gameId,
        title: game.title,
        icon: game.icon,
      },
      achievements: achievementDtos,
    };
  }
}
