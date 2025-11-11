import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { User } from '../domain/users/user.entity';
import { OwnedGameRepository } from '../domain/games/owned-game.repository';
import { AchievementRepository } from '../domain/achievements/achievement.repository';
import { UserAchievementRepository } from '../domain/achievements/user-achievement.repository';
import {
  SteamApiService,
  AchievementSchema,
  PlayerAchievementsApiResponse,
} from './steam.api.service';
import { UserSummaryRepository } from '../domain/users/user-summary.repository';
import { DashboardService } from '../dashboard/dashboard.service';
import { UserSummary } from '../domain/users/user-summary.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';

@Injectable()
export class SteamSyncService {
  private readonly logger = new Logger(SteamSyncService.name);

  constructor(
    @Inject(forwardRef(() => OwnedGameRepository))
    private readonly ownedGameRepo: OwnedGameRepository,
    private readonly achievementRepo: AchievementRepository,
    private readonly userAchRepo: UserAchievementRepository,
    private readonly steamApi: SteamApiService,
    private readonly userSummaryRepo: UserSummaryRepository,
    @Inject(forwardRef(() => DashboardService))
    private readonly dashboardService: DashboardService,
  ) {}

  /** 🎯 전체 동기화 (소유 게임 + 업적 + 요약) */
  async syncUserData(user: Pick<User, 'id' | 'steamId'>): Promise<void> {
    this.logger.debug(`[SteamSync] Sync start for user:${user.id}`);

    const { games, owned } = await this.ownedGameRepo.fetchOwnedGamesAsRows(
      this.steamApi['key'],
      user,
    );

    this.logger.debug(
      `[SteamSync] Owned games count from Steam API: ${owned.length}`,
    );

    await Promise.all([
      this.ownedGameRepo.upsertGames(games),
      this.ownedGameRepo.upsertOwnedMany(owned),
    ]);

    // ✅ 타입 안전하게 가져오기
    const ownedWithRelations: OwnedGame[] =
      await this.ownedGameRepo.findAllWithGame(user.id);

    // ✅ reduce 타입 명시
    const mostPlayed: OwnedGame | undefined = ownedWithRelations.reduce(
      (prev: OwnedGame | undefined, curr: OwnedGame): OwnedGame =>
        !prev || (curr.playtimeForever ?? 0) > (prev.playtimeForever ?? 0)
          ? curr
          : prev,
      undefined,
    );

    this.logger.debug(
      `[SteamSync] mostPlayed: ${mostPlayed?.game?.title ?? '❌ None'}`,
    );

    // ✅ 업적 및 유저 업적 동기화
    for (const g of games) {
      const gameId = g.gameId;
      if (!gameId) continue;

      try {
        await this.syncGameAndUserAchievements(user, gameId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[SteamSync] Skipped game:${gameId} (${message})`);
      }
    }

    await this.updateUserSummary(user, owned, mostPlayed);
    await this.dashboardService.refreshDashboard(user.id);

    this.logger.debug(`[SteamSync] Completed for user:${user.id}`);
  }

  /** 🎯 단일 게임의 스키마 + 유저 업적 동기화 */
  async syncGameAndUserAchievements(
    user: Pick<User, 'id' | 'steamId'>,
    gameId: number,
  ): Promise<void> {
    const hasSchema = await this.achievementRepo.exist({ where: { gameId } });

    // 1️⃣ 업적 스키마 갱신
    if (!hasSchema) {
      const schema = await this.steamApi.getSchemaForGame(gameId);
      const achDefs: AchievementSchema[] = Array.isArray(
        schema?.availableGameStats?.achievements,
      )
        ? schema.availableGameStats.achievements
        : [];

      if (achDefs.length > 0) {
        const rows = achDefs.map((ach) => ({
          gameId,
          apiName: ach.name,
          displayName: ach.displayName ?? ach.name,
          description: ach.description,
          hidden: ach.hidden === 1,
          icon: ach.icon,
          iconGray: ach.icongray,
        }));
        await this.achievementRepo.upsertMany(rows);
        this.logger.debug(
          `[SteamSync] ${rows.length} achievements added for game:${gameId}`,
        );
      }
    }

    // 2️⃣ 유저 업적 동기화
    const playerData: PlayerAchievementsApiResponse | null =
      await this.steamApi.getPlayerAchievements(gameId, user.steamId);

    // 안전한 타입 가드
    const achievements = Array.isArray(playerData?.playerstats?.achievements)
      ? playerData.playerstats.achievements
      : [];

    if (achievements.length === 0) return;

    const rows = achievements.map((a) => ({
      userId: user.id,
      gameId,
      apiName: a.apiname,
      achieved: a.achieved === 1,
      unlockedAt:
        typeof a.unlockedAt === 'number' && a.unlockedAt > 0
          ? new Date(a.unlockedAt * 1000)
          : undefined,
    }));

    await this.userAchRepo.upsertMany(rows);

    this.logger.debug(
      `[SteamSync] Synced ${rows.length} user achievements for game:${gameId}`,
    );
  }

  /** 🎯 요약 정보 업데이트 */
  private async updateUserSummary(
    user: Pick<User, 'id' | 'steamId'>,
    owned: Array<{ playtimeForever?: number; playtime2Weeks?: number }>,
    mostPlayed?: OwnedGame,
  ): Promise<void> {
    const totalGames = owned.length;
    const totalPlaytime = owned.reduce(
      (sum, g) => sum + (g.playtimeForever ?? 0),
      0,
    );
    const recentPlaytime = owned.reduce(
      (sum, g) => sum + (g.playtime2Weeks ?? 0),
      0,
    );

    const [earned, total] = await Promise.all([
      this.userAchRepo.count({ where: { userId: user.id, achieved: true } }),
      this.userAchRepo.count({ where: { userId: user.id } }),
    ]);

    const ratio = total > 0 ? Math.round((earned / total) * 10000) / 100 : 0;

    const summaryData: Partial<UserSummary> = {
      userId: user.id,
      total_games: totalGames,
      total_playtime_minutes: totalPlaytime,
      recent_playtime_2weeks_minutes: recentPlaytime,
      achievement_earned: earned,
      achievement_total: total,
      achievement_ratio: ratio,
      most_played_game: mostPlayed
        ? {
            gameId: mostPlayed.gameId ?? 0,
            title: mostPlayed.game?.title ?? 'Unknown Game',
            playtime_forever: mostPlayed.playtimeForever ?? 0,
            ...(mostPlayed.game?.icon ? { icon: mostPlayed.game.icon } : {}),
          }
        : undefined,
      last_played_at: mostPlayed?.lastPlayedAt ?? undefined,
    };

    await this.userSummaryRepo.upsertSummary(summaryData);
  }
}
