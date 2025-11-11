import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import axios from 'axios';

import { OwnedGame } from './owned-game.entity';
import { Game } from './game.entity';
import { User } from '../users/user.entity';
import { Achievement } from '../achievements/achievement.entity';
import { UserAchievement } from '../achievements/user-achievement.entity';
import { SteamApiService } from '../../api/steam.api.service';
import { UserAchievementRepository } from '../achievements/user-achievement.repository';
import { AchievementRepository } from '../achievements/achievement.repository';
import { SteamSyncService } from '../../api/steam-sync.service';
import { UserSummaryRepository } from '../users/user-summary.repository';

// ✅ 타입 안전 Steam 응답 구조
interface SteamOwnedGameRaw {
  appid: number;
  name?: string;
  img_icon_url?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  rtime_last_played?: number;
}

interface SteamOwnedGamesResp {
  response?: {
    game_count?: number;
    games?: SteamOwnedGameRaw[];
  };
}

@Injectable()
export class OwnedGameRepository {
  private readonly logger = new Logger(OwnedGameRepository.name);

  constructor(
    @InjectRepository(OwnedGame)
    private readonly repo: Repository<OwnedGame>,
    @InjectRepository(Game)
    private readonly gameRepo: Repository<Game>,
    private readonly achievementRepo: AchievementRepository,
    private readonly userAchRepo: UserAchievementRepository,
    private readonly steamApi: SteamApiService,
    @Inject(forwardRef(() => SteamSyncService))
    private readonly syncService: SteamSyncService,
    private readonly userSummaryRepo: UserSummaryRepository,
  ) {}

  // ✅ 안전한 Steam API 호출 및 변환
  async fetchOwnedGamesAsRows(
    steamKey: string,
    user: Pick<User, 'id' | 'steamId'>,
  ): Promise<{
    games: Array<Partial<Game>>;
    owned: Array<Partial<OwnedGame>>;
  }> {
    try {
      const { data } = await axios.get<SteamOwnedGamesResp>(
        'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/',
        {
          params: {
            key: steamKey,
            steamid: user.steamId,
            include_appinfo: 1,
            include_played_free_games: 1,
          },
          timeout: 7000,
        },
      );

      const list = (data.response?.games ?? []).filter(
        (g): g is SteamOwnedGameRaw =>
          typeof g.appid === 'number' && g.appid > 0 && !!g.name,
      );

      const games: Array<Partial<Game>> = list.map((g) => {
        const appId = g.appid;
        const title = g.name ?? `App ${appId}`;
        const icon = g.img_icon_url
          ? `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${g.img_icon_url}.jpg`
          : `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_231x87.jpg`;

        return { gameId: appId, title, icon };
      });

      const owned: Array<Partial<OwnedGame>> = list.map((g) => {
        const lastPlayedAt =
          typeof g.rtime_last_played === 'number' && g.rtime_last_played > 0
            ? new Date(g.rtime_last_played * 1000)
            : null;

        return {
          userId: user.id,
          gameId: g.appid,
          playtimeForever: g.playtime_forever ?? 0,
          playtime2Weeks: g.playtime_2weeks ?? 0,
          lastPlayedAt,
        };
      });

      return { games, owned };
    } catch (err) {
      this.logger.error(`Steam OwnedGames fetch failed: ${String(err)}`);
      return { games: [], owned: [] };
    }
  }

  async upsertGames(rows: Array<Partial<Game>>): Promise<void> {
    if (rows.length === 0) return;
    await this.gameRepo.upsert(rows, {
      conflictPaths: ['gameId'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  async upsertOwnedMany(rows: Array<Partial<OwnedGame>>): Promise<void> {
    if (rows.length === 0) return;
    await this.repo.upsert(rows, {
      conflictPaths: ['userId', 'gameId'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  qbForUser(userId: number): SelectQueryBuilder<OwnedGame> {
    return this.repo
      .createQueryBuilder('og')
      .where('og.userId = :userId', { userId });
  }

  // ✅ 업적 / 정렬 / 페이징 포함 목록 조회
  async listForUserQB(
    userId: number,
    opts: {
      sort:
        | 'playtimeForever'
        | 'playtime2Weeks'
        | 'gameId'
        | 'name'
        | 'lastPlayedAt';
      order: 'asc' | 'desc';
      page: number;
      size: number;
      keyword?: string;
      includeAch?: boolean;
    },
  ) {
    const order = opts.order === 'asc' ? 'ASC' : 'DESC';
    const includeAch = opts.includeAch ?? true;

    const dataQb = this.qbForUser(userId)
      .select('og')
      .innerJoin(Game, 'g', 'g.gameId = og.gameId')
      .addSelect(['g.title AS g_title', 'g.icon AS g_icon']);
    console.log('[SQL]', dataQb.getSql());

    if (opts.keyword) {
      const kw = `%${opts.keyword.trim()}%`;
      dataQb.andWhere('g.title ILIKE :kw', { kw });
    }

    const SORT_MAP = {
      name: 'g.title',
      playtime2Weeks: 'og.playtime2Weeks',
      gameId: 'og.gameId',
      playtimeForever: 'og.playtimeForever',
      lastPlayedAt: 'og.lastPlayedAt',
    } as const;

    const sortExpr = SORT_MAP[opts.sort] ?? SORT_MAP.playtimeForever;

    if (includeAch) {
      const defsSub = this.repo.manager
        .createQueryBuilder()
        .select('COUNT(1)')
        .from(Achievement, 'a')
        .where('a.gameId = og.gameId');

      const unlockedSub = this.repo.manager
        .createQueryBuilder()
        .select('COUNT(1)')
        .from(UserAchievement, 'ua')
        .where('ua.gameId = og.gameId')
        .andWhere('ua.userId = og.userId')
        .andWhere('ua.unlockedAt IS NOT NULL');

      dataQb
        .addSelect(`(${defsSub.getQuery()})`, 'ach_total')
        .addSelect(`(${unlockedSub.getQuery()})`, 'ach_unlocked')
        .addSelect(
          `CASE WHEN (${defsSub.getQuery()}) > 0
                THEN (${unlockedSub.getQuery()})::float / (${defsSub.getQuery()})
                ELSE 0 END`,
          'ach_rate',
        )
        .setParameters({
          ...defsSub.getParameters(),
          ...unlockedSub.getParameters(),
        });
    }

    dataQb
      .orderBy(sortExpr, order)
      .addOrderBy('og.gameId', 'ASC')
      .skip((opts.page - 1) * opts.size)
      .take(opts.size);

    const { entities, raw } = await dataQb.getRawAndEntities();

    const countQb = this.qbForUser(userId);
    if (opts.keyword) {
      const kw = `%${opts.keyword.trim()}%`;
      const sub = this.repo.manager
        .createQueryBuilder()
        .select('1')
        .from(Game, 'g2')
        .where('g2.gameId = og.gameId')
        .andWhere('g2.title ILIKE :kw', { kw });

      countQb
        .andWhere(`EXISTS (${sub.getQuery()})`)
        .setParameters(sub.getParameters());
    }
    const total = await countQb.getCount();

    const items = entities.map((og, i) => {
      const r = raw[i] as Record<string, unknown>;
      const achTotal = Number(r['ach_total'] ?? 0);
      const achUnlocked = Number(r['ach_unlocked'] ?? 0);
      const achRate = Number(r['ach_rate'] ?? 0);

      const name = typeof r['g_title'] === 'string' ? r['g_title'] : '';
      const icon = typeof r['g_icon'] === 'string' ? r['g_icon'] : null;

      return {
        appId: og.gameId,
        name,
        icon,
        you: {
          playtimeForever: og.playtimeForever,
          playtime2Weeks: og.playtime2Weeks,
          lastPlayedAt: og.lastPlayedAt,
        },
        achievements: {
          supported: achTotal > 0,
          unlocked: achUnlocked,
          total: achTotal,
          completion_rate: achRate,
        },
      };
    });

    return { items, total };
  }

  // 🎯 사용자 전체 게임 동기화
  async fetchAndSyncAll(user: Pick<User, 'id' | 'steamId'>): Promise<void> {
    this.logger.log(`[Sync] Fetching owned games for user:${user.id}`);
    const { games, owned } = await this.fetchOwnedGamesAsRows(
      process.env.STEAM_API_KEY!,
      user,
    );

    if (!games.length) {
      this.logger.warn(`[Sync] No games found for user:${user.id}`);
      return;
    }

    await this.upsertGames(games);
    await this.upsertOwnedMany(owned);
    await this.updateUserSummary(user.id);

    for (const g of games) {
      if (!g.gameId) continue;
      try {
        await this.syncService.syncGameAndUserAchievements(user, g.gameId);
      } catch (err: unknown) {
        this.logger.warn(`[Sync] Skipped game ${g.gameId}: ${String(err)}`);
      }
    }

    this.logger.log(
      `[Sync] Completed for user:${user.id} — ${games.length} games synced.`,
    );
  }

  private async updateUserSummary(userId: number): Promise<void> {
    const ownedGames = await this.repo.find({
      where: { userId },
      relations: ['game'],
    });

    const total_games = ownedGames.length;
    const total_playtime_minutes = ownedGames.reduce(
      (sum, g) => sum + g.playtimeForever,
      0,
    );
    const recent_playtime_2weeks_minutes = ownedGames.reduce(
      (sum, g) => sum + g.playtime2Weeks,
      0,
    );

    const mostPlayed = ownedGames.length
      ? ownedGames.reduce((a, b) =>
          b.playtimeForever > a.playtimeForever ? b : a,
        )
      : null;

    const [earned, total] = await Promise.all([
      this.userAchRepo.count({ where: { userId, achieved: true } }),
      this.userAchRepo.count({ where: { userId } }),
    ]);

    const ratio = total > 0 ? Math.round((earned / total) * 10000) / 100 : 0;

    await this.userSummaryRepo.upsertSummary({
      userId,
      total_games,
      total_playtime_minutes,
      recent_playtime_2weeks_minutes,
      most_played_game: mostPlayed
        ? {
            gameId: mostPlayed.gameId,
            title: mostPlayed.game?.title ?? 'Unknown Game',
            playtime_forever: mostPlayed.playtimeForever,
            icon: mostPlayed.game?.icon ?? undefined,
          }
        : undefined,
      last_played_at: mostPlayed?.lastPlayedAt ?? undefined,
      achievement_earned: earned,
      achievement_total: total,
      achievement_ratio: ratio,
    });
  }

  async findAllWithGame(userId: number): Promise<OwnedGame[]> {
    return this.repo.find({
      where: { userId },
      relations: ['game'],
    });
  }
}
