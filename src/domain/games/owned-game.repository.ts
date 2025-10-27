import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { OwnedGame } from './owned-game.entity';
import { Game } from './game.entity';
import axios from 'axios';
import { User } from '../users/user.entity';
import { Achievement } from '../achievements/achievement.entity';
import { UserAchievement } from '../achievements/user-achievement.entity';

type SteamOwnedGamesResp = {
  response?: {
    game_count?: number;
    games?: Array<{
      appid: number;
      name?: string;
      img_icon_url?: string;
      playtime_forever?: number;
      playtime_2weeks?: number;
      rtime_last_played?: number;
    }>;
  };
};
@Injectable()
export class OwnedGameRepository {
  constructor(
    @InjectRepository(OwnedGame) private readonly repo: Repository<OwnedGame>,
    @InjectRepository(Game) private readonly gameRepo: Repository<Game>,
  ) {}

  async fetchOwnedGamesAsRows(
    steamKey: string,
    user: Pick<User, 'id' | 'steamId'>,
  ): Promise<{
    games: Array<Partial<Game>>;
    owned: Array<Partial<OwnedGame>>;
  }> {
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

    const list = data?.response?.games ?? [];

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
        playtimeForever:
          typeof g.playtime_forever === 'number' ? g.playtime_forever : 0,
        playtime2Weeks:
          typeof g.playtime_2weeks === 'number' ? g.playtime_2weeks : 0,
        lastPlayedAt,
      };
    });

    return { games, owned };
  }

  /** Game PK(gameId) 기준 upsert */
  async upsertGames(rows: Array<Partial<Game>>): Promise<void> {
    if (!rows.length) return;
    await this.gameRepo.upsert(rows, {
      conflictPaths: ['gameId'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  /** OwnedGame 복합키(userId, gameId) 기준 upsert */
  async upsertOwnedMany(rows: Array<Partial<OwnedGame>>): Promise<void> {
    if (!rows.length) return;
    await this.repo.upsert(rows, {
      conflictPaths: ['userId', 'gameId'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  // 사용자별 조회용 기본 QB
  qbForUser(userId: number): SelectQueryBuilder<OwnedGame> {
    return this.repo
      .createQueryBuilder('og')
      .where('og.userId = :userId', { userId });
  }

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
    //데이터 쿼리(필요할 때만 조인)
    const includeAch = opts.includeAch ?? true;
    const dataQb = this.qbForUser(userId).select('og');

    dataQb.innerJoin(Game, 'g', 'g.gameId = og.gameId');
    dataQb.addSelect('g.title', 'g_title');
    dataQb.addSelect('g.icon', 'g_icon');

    if (opts.keyword) {
      const kw = `%${opts.keyword.trim()}%`;
      dataQb.andWhere('g.title ILIKE :kw', { kw });
    }

    //안전한 정렬 컬럼 화이트리스트 매핑
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
                THEN (${unlockedSub.getQuery()})::float /(${defsSub.getQuery()}) 
                ELSE 0 END`,
          'ach_rate',
        )
        .setParameters({
          ...defsSub.getParameters(),
          ...unlockedSub.getParameters(),
        });
    }
    dataQb
      .orderBy(sortExpr, order.toUpperCase() as 'ASC' | 'DESC', 'NULLS LAST')
      .addOrderBy('og.gameId', 'ASC')
      .skip((opts.page - 1) * opts.size)
      .take(opts.size);

    const { entities, raw } = await dataQb.getRawAndEntities();

    // 2) 카운트 쿼리 (조인 제거 + EXISTS)
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

      return {
        appId: og.gameId,
        name: (r['g_title'] as string) ?? '',
        icon: (r['g_icon'] as string) ?? null,
        you: {
          playtimeForever: og.playtimeForever,
          playtime2Weeks: og.playtime2Weeks,
          lastPlayedAt: og.lastPlayedAt,
          installed: og.installed,
          hidden: og.hidden,
          addedAt: og.addedAt ? og.addedAt.toISOString() : null,
        },
        achievements: includeAch
          ? {
              supported: achTotal > 0,
              unlocked: achUnlocked,
              total: achTotal,
              completion_rate: achRate,
            }
          : undefined,
        links: {
          game: `/api/v1/games/${og.gameId}`,
          achievements_me: `/api/v1/me/games/${og.gameId}/achievements`,
          achievements_defs: `/api/v1/games/${og.gameId}/achievements`,
        },
      };
    });

    return { items, total };
  }

  async summarizeForUser(userId: number) {
    const row = await this.qbForUser(userId)
      .select([
        'COUNT(*)::int AS total',
        'COUNT(*) FILTER (WHERE og.installed) ::int AS installed',
        'COUNT(*) FILTER (WHERE og.playtime2Weeks >0) ::int AS recent_played',
      ])
      .getRawOne<{ total: number; installed: number; recent_played: number }>();

    const achRow = await this.repo.manager
      .createQueryBuilder()
      .select([
        `COUNT(DISTINCT og.gameId) FILTER (
          WHERE EXISTS (SELECT 1 FROM achievement a WHERE a.gameId = og.gameId)
          )::int AS with_achievements`,
        `COALESCE(
            AVG(
              (SELECT COUNT(1) FROM user_achievement ua
              where ua.gameId = og.gameId AND ua.userId = og.userId AND ua.unlockedAt IS NOT NULL
              )::float
              / NULLIF(
                (SELECT COUNT(1) FROM achievement a WHERE a.gameId = og.gameId),
                0
                )
                ),
                0) AS avg_completion_rate`,
      ])
      .from(OwnedGame, 'og')
      .where('og.userId = :userId', { userId })
      .getRawOne<{ with_achievements: number; avg_completion_rate: number }>();

    return {
      total: row?.total ?? 0,
      installed: row?.installed ?? 0,
      recent_played: row?.recent_played ?? 0,
      with_achievements: achRow?.with_achievements ?? 0,
      avg_completion_rate: Number(achRow?.avg_completion_rate ?? 0),
    };
  }
}
