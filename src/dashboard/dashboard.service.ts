import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  Inject,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Repository } from 'typeorm';
import type { Cache } from 'cache-manager';

import { User } from '../domain/users/user.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';
import { Friend } from '../domain/friends/friends.entity';
import { ownedGameDto } from '../dto/ownedGame.dto';
import { FriendDto } from '../dto/friends.dto';
import { DashboardDataDto } from '../dto/dashboardData.dto';
import { DashboardResponseDto } from '../dto/dashboardResponse.dto';
import { SummaryDto } from '../dto/summary.dto';
import { SteamSyncService } from '../api/steam-sync.service';
import { UserSummaryRepository } from '../domain/users/user-summary.repository';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(OwnedGame)
    private readonly ownedGameRepo: Repository<OwnedGame>,
    @InjectRepository(Friend)
    private readonly friendRepo: Repository<Friend>,
    @Inject(forwardRef(() => SteamSyncService))
    private readonly steamSync: SteamSyncService,
    private readonly userSummaryRepo: UserSummaryRepository,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * 🎯 대시보드 데이터 조회 + 캐시 + Steam API 동기화
   */
  async getSteamDashboard(userId: number): Promise<DashboardResponseDto> {
    const start = Date.now();
    const cacheKey = `dashboard:user:${userId}`;
    const ttl = 600; // 10분 TTL

    try {
      // ✅ 1️⃣ 캐시 확인
      const cached =
        await this.cacheManager.get<DashboardResponseDto>(cacheKey);
      if (cached) {
        const took = Date.now() - start;
        this.logger.debug(`[Dashboard] Cache HIT user:${userId} (${took}ms)`);
        return cached;
      }

      this.logger.debug(`[Dashboard] Cache MISS user:${userId} — syncing...`);

      // ✅ 2️⃣ 유저 검증
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) {
        throw new UnauthorizedException('User not found or session expired');
      }

      // ✅ 3️⃣ Steam 데이터 동기화 (실패해도 캐시 fallback 허용)
      try {
        await this.steamSync.syncUserData(user);
      } catch (syncErr) {
        this.logger.warn(`[Dashboard] SteamSync failed: ${String(syncErr)}`);
        const cachedBackup =
          await this.cacheManager.get<DashboardResponseDto>(cacheKey);
        if (cachedBackup) {
          this.logger.warn(
            `[Dashboard] Returning last cached data for user:${userId}`,
          );
          return cachedBackup;
        }
      }

      // ✅ 4️⃣ 최신 요약 정보 조회
      const summaryEntity = await this.userSummaryRepo.findByUserId(user.id);
      if (!summaryEntity) {
        throw new InternalServerErrorException(
          'User summary not found after sync',
        );
      }

      const summary: SummaryDto = {
        total_games: summaryEntity.total_games,
        total_playtime_minutes: summaryEntity.total_playtime_minutes,
        recent_playtime_2weeks_minutes:
          summaryEntity.recent_playtime_2weeks_minutes,
        most_played_game: summaryEntity.most_played_game ?? null,
        last_played_at: summaryEntity.last_played_at ?? new Date(0),
      };

      // ✅ 5️⃣ 최근 플레이한 게임
      const ownedGames = await this.ownedGameRepo.find({
        where: { userId },
        relations: ['game'],
        take: 10,
        order: { playtime2Weeks: 'DESC' },
      });

      const oGames: ownedGameDto[] = ownedGames.map((g) => ({
        id: g.id,
        userId: g.userId,
        gameId: g.gameId,
        title: g.game?.title ?? 'Unknown Game',
        icon: g.game?.icon ?? undefined,
        playtime_forever: g.playtimeForever,
        playtime_2weeks: g.playtime2Weeks,
        created_at: g.created_at,
        updated_at: g.updated_at,
        last_played_at: g.lastPlayedAt ?? new Date(0),
      }));

      // ✅ 6️⃣ 친구 목록
      const friends = await this.friendRepo.find({ where: { userId } });
      const friendDtos: FriendDto[] = friends.map((f) => ({
        id: f.id,
        userId: f.userId,
        friendId: f.friendId,
        friend_since: f.friend_since ? f.friend_since.toISOString() : null,
        created_at: f.created_at.toISOString(),
        updated_at: f.updated_at.toISOString(),
      }));

      // ✅ 7️⃣ 대시보드 데이터 구성
      const data: DashboardDataDto = {
        profile: {
          steamid: String(user.steamId),
          personaName: user.personaName ?? 'Unknown',
          avatar: user.avatar ?? undefined,
        },
        summary,
        recently_played: oGames,
        achievement_progress: {
          earned: summaryEntity.achievement_earned,
          total: summaryEntity.achievement_total,
          ratio: summaryEntity.achievement_ratio,
        },
        friends: {
          count: friendDtos.length,
          list: friendDtos,
        },
        quick_links: {
          games: '/games',
          friends: '/friends',
          achievements: '/achievements',
        },
      };

      const response: DashboardResponseDto = { data, error: null };

      // ✅ 8️⃣ 캐시에 저장
      await this.cacheManager.set(cacheKey, response, 600);
      const took = Date.now() - start;
      this.logger.debug(
        `[Dashboard] Cached dashboard for user:${userId} (${took}ms, ttl=${ttl}s)`,
      );

      return response;
    } catch (err: unknown) {
      this.logger.error(
        `[Dashboard] Failed for user:${userId} — ${String(err)}`,
      );
      throw new InternalServerErrorException('Failed to load dashboard data');
    }
  }

  /**
   * 🎯 캐시 무효화 (외부 호출용)
   */
  async refreshDashboard(userId: number): Promise<void> {
    const cacheKey = `dashboard:user:${userId}`;
    await this.cacheManager.del(cacheKey);
    this.logger.debug(`[Dashboard] Cache invalidated for user:${userId}`);
  }
}
