// userAchievement.service.ts
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { userAchievementDto } from '../dto/userAchievement.dto';
import { User } from '../domain/users/user.entity';
import { Game } from '../domain/games/game.entity';
import { ExceptionService } from '../common/exceptions/exception.service';
import { Achievement } from '../domain/achievements/achievement.entity';
import { UserAchievement } from '../domain/achievements/user-achievement.entity';
import { Friend } from '../domain/friends/friends.entity';
import type { RankingEntryDto } from '../dto/rankingEntry.dto';
import type { RankingResponseDto } from '../dto/rankingResponse.dto';

@Injectable()
export class UserAchievementService {
  constructor(
    @InjectRepository(UserAchievement)
    private readonly userAchievementRepository: Repository<UserAchievement>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Game)
    private readonly gameRepository: Repository<Game>,
    @InjectRepository(Achievement)
    private readonly achievementRepository: Repository<Achievement>,
    @InjectRepository(Friend)
    private readonly friendRepository: Repository<Friend>,
    private readonly exceptionService: ExceptionService,
  ) {
    /* 공백 */
  }

  private async getTotalAchievements(gameId: number): Promise<number> {
    return this.achievementRepository.count({ where: { gameId } });
  }

  // TODO: Friend 엔티티 컬럼(userId, friendId) 또는 관계(user, friend)에 맞춰 필요 시 수정
  private async getFriendIdsOf(meId: number): Promise<number[]> {
    const rows = await this.friendRepository
      .createQueryBuilder('f')
      .select(
        `CASE WHEN f.userId = :me THEN f.friendId ELSE f.userId END`,
        'fid',
      )
      .where('f.userId = :me OR f.friendId = :me', { me: meId })
      .getRawMany<{ fid: string | number }>();

    const ids = Array.from(
      new Set(
        rows
          .map((r) => Number(r.fid))
          .filter((n) => Number.isFinite(n) && n !== meId),
      ),
    );
    return ids;
  }

  // 랭킹: scope = global|friends
  async getGameLeaderboardWithMyRank(
    gameId: number,
    meId: number,
    scope: 'global' | 'friends',
    limit = 50,
    offset = 0,
  ): Promise<RankingResponseDto> {
    const totalAchievements = await this.getTotalAchievements(gameId);

    let scopeIds: number[] | undefined;
    if (scope === 'friends') {
      const friends = await this.getFriendIdsOf(meId);
      // 친구 + 나 포함
      scopeIds = [meId, ...friends];
    }

    // 베이스 집계
    const baseQb = this.userAchievementRepository
      .createQueryBuilder('ua')
      .leftJoin(
        'achievement',
        'a',
        'a.apiName = ua.apiName AND a.gameId = ua.gameId',
      )
      .select('ua.userId', 'userId')
      .addSelect('COUNT(DISTINCT a.id)', 'completed')
      .where('ua.gameId = :gameId', { gameId })
      .groupBy('ua.userId');

    if (scopeIds && scopeIds.length > 0) {
      baseQb.andWhere('ua.userId IN (:...scopeIds)', { scopeIds });
    }

    const totalUsers = (await baseQb.clone().getRawMany()).length;

    const rows = await baseQb
      .clone()
      .orderBy('completed', 'DESC')
      .addOrderBy('ua.userId', 'ASC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{ userId: number; completed: string }>();

    const items: RankingEntryDto[] = rows.map((r, idx) => {
      const completed = Number(r.completed) || 0;
      const percent = totalAchievements
        ? Math.round((completed / totalAchievements) * 10000) / 100
        : 0;
      return {
        userId: Number(r.userId),
        completed,
        total: totalAchievements,
        percent,
        rank: offset + idx + 1,
      };
    });

    // 내 완료 개수
    const myCompletedRaw = await this.userAchievementRepository
      .createQueryBuilder('ua')
      .leftJoin(
        'achievement',
        'a',
        'a.apiName = ua.apiName AND a.gameId = ua.gameId',
      )
      .select('COUNT(DISTINCT a.id)', 'cnt')
      .where('ua.gameId = :gameId', { gameId })
      .andWhere('ua.userId = :meId', { meId })
      .getRawOne<{ cnt: string }>();
    const myCompleted = Number(myCompletedRaw?.cnt ?? 0);

    // 순위 계산 서브쿼리에서도 동일 scopeIds 적용
    const rankCountRaw = await this.userAchievementRepository.manager
      .createQueryBuilder()
      .select('COUNT(*)', 'cnt')
      .from((qb) => {
        const sq = qb
          .subQuery()
          .select('ua.userId', 'userId')
          .addSelect('COUNT(DISTINCT a.id)', 'completed')
          .from(UserAchievement, 'ua')
          .leftJoin(
            Achievement,
            'a',
            'a.apiName = ua.apiName AND a.gameId = ua.gameId',
          )
          .where('ua.gameId = :gameId')
          .groupBy('ua.userId');

        if (scopeIds && scopeIds.length > 0) {
          sq.andWhere('ua.userId IN (:...scopeIds)');
        }
        return sq;
      }, 't')
      .where(
        '("t"."completed" > :mc) OR ("t"."completed" = :mc AND "t"."userId" < :me)',
        { mc: myCompleted, me: meId },
      )
      .setParameters({
        gameId,
        ...(scopeIds && scopeIds.length > 0 ? { scopeIds } : {}),
      })
      .getRawOne<{ cnt: string }>();

    const myRank = Number(rankCountRaw?.cnt ?? 0) + 1;
    const myPercent = totalAchievements
      ? Math.round((myCompleted / totalAchievements) * 10000) / 100
      : 0;

    const myEntry: RankingEntryDto = {
      userId: meId,
      completed: myCompleted,
      total: totalAchievements,
      percent: myPercent,
      rank: totalUsers ? myRank : 0,
    };

    return { scope, totalUsers, totalAchievements, items, myEntry };
  }

  async getUserGameAchievements(
    userId: number,
    gameId: number,
  ): Promise<userAchievementDto[]> {
    // 401: 토큰 누락/만료
    if (!userId) {
      this.exceptionService.throwUnauthorized();
    }

    // 403: Steam 미연동
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user?.steamId) {
      this.exceptionService.throwSteamLinkRequired();
    }

    // 404: 게임 없음
    const game = await this.gameRepository.findOne({
      where: { gameId: gameId },
    });
    if (!game) {
      this.exceptionService.throwGameNotFound(
        `지원하지 않는 게임 ID: ${gameId}`,
      );
    }

    // 업적 조회
    const achievements = await this.userAchievementRepository.find({
      where: { userId, gameId },
      relations: ['achievement'],
    });

    // 404: 업적 시스템 없음
    if (!achievements.length) {
      this.exceptionService.throwAchievementsNotAvailable(
        `해당 게임 업적을 사용할 수 없습니다: ${gameId}`,
      );
    }

    // 정상 반환
    return achievements.map((a) => ({
      id: a.id,
      userId: a.userId,
      gameId: a.gameId,
      apiName: a.achievement.apiName,
      name: a.achievement.displayName,
      description: a.achievement.description,
      hidden: a.achievement.hidden,
      icon: a.achievement.icon,
      unlocked_at: a.unlockedAt,
    }));
  }
}
