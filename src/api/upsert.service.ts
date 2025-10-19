import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type FindOptionsOrder } from 'typeorm';
import { Achievement } from '../domain/achievements/achievement.entity';
import { UserAchievement } from '../domain/achievements/user-achievement.entity';
import { SteamApiService, type AchievementSchema } from './steam.api.service';
import { Game } from '../domain/games/game.entity';
import { OwnedGame as OwnedGameEntity } from '../domain/games/owned-game.entity';
import { User } from '../domain/users/user.entity';
import { Friend } from '../domain/friends/friends.entity';

// 업적 최소 형태
type SimpleAchievement = {
  apiname: string;
  achieved: 0 | 1;
  unlocktime?: number;
};

// Steam GetPlayerAchievements 최소 응답 형태
type PlayerStatsShape = {
  playerstats?: {
    achievements?: unknown[];
  };
};

// 타입 가드: 전체 응답이 기대 형태인지
function isPlayerStatsResponse(x: unknown): x is PlayerStatsShape {
  if (typeof x !== 'object' || x === null) return false;
  const ps = (x as Record<string, unknown>).playerstats;
  if (typeof ps !== 'object' || ps === null) return false;
  const arr = (ps as Record<string, unknown>).achievements;
  return arr === undefined || Array.isArray(arr);
}

// 타입 가드: 단일 업적 항목을 안전하게 변환
function toAchievement(x: unknown): SimpleAchievement | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  const apiname = r.apiname;
  const achieved = r.achieved;
  const unlocktime = r.unlocktime;
  if (typeof apiname !== 'string') return null;
  if (achieved !== 0 && achieved !== 1 && typeof achieved !== 'number')
    return null;
  const ach: SimpleAchievement = {
    apiname,
    achieved: achieved === 0 || achieved === 1 ? achieved : achieved ? 1 : 0,
  };
  if (typeof unlocktime === 'number') ach.unlocktime = unlocktime;
  return ach;
}

@Injectable()
export class UpsertService {
  private readonly logger = new Logger(UpsertService.name);

  constructor(
    private readonly steam: SteamApiService,
    @InjectRepository(Game) private readonly gameRepo: Repository<Game>,
    @InjectRepository(OwnedGameEntity)
    private readonly ownedRepo: Repository<OwnedGameEntity>,
    @InjectRepository(Achievement)
    private readonly achRepo: Repository<Achievement>,
    @InjectRepository(UserAchievement)
    private readonly uaRepo: Repository<UserAchievement>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Friend) private readonly friendsRepo: Repository<Friend>,
  ) {}

  async syncUserAll(steamId64: string, userId: number) {
    const owned = await this.steam.getOwnedGames(steamId64);
    for (const g of owned) {
      const appId = Number(g.appid);

      await this.gameRepo.upsert(
        { gameId: appId, title: g.name ?? String(appId) },
        ['gameId'],
      );
      await this.ownedRepo.upsert({ userId, gameId: appId }, [
        'userId',
        'gameId',
      ]);

      // 1) 업적 스키마 upsert
      const schema = await this.steam.getSchemaForGame(appId);
      const achs = schema.availableGameStats?.achievements ?? [];
      if (achs.length) {
        const rows: Partial<Achievement>[] = achs.map(
          (a: AchievementSchema) => ({
            gameId: appId,
            apiName: a.name,
            displayName: a.displayName ?? a.name,
            hidden: !!a.hidden,
            icon: a.icon,
            iconGray: a.icongray,
          }),
        );
        await this.achRepo.upsert(rows, ['gameId', 'apiName']);
      }

      // 2) 스키마가 없으면 플레이어 업적 호출 생략
      if (achs.length === 0) continue;

      // 3) 플레이어 업적 안전 파싱 (400/403/404는 null 반환)
      const psRaw = await this.steam.getPlayerAchievements(appId, steamId64);
      const psUnknown: unknown = psRaw ?? {};
      const achievementsArr: unknown[] = isPlayerStatsResponse(psUnknown)
        ? (psUnknown.playerstats?.achievements ?? [])
        : [];

      const playerAchs: SimpleAchievement[] = [];
      for (const it of achievementsArr) {
        const a = toAchievement(it);
        if (a) playerAchs.push(a);
      }

      const uaRows: Partial<UserAchievement>[] = playerAchs
        .filter((u) => u.achieved === 1)
        .map((u) => ({
          userId,
          gameId: appId,
          apiName: u.apiname,
          achieved: true,
          unlockedAt: u.unlocktime ? new Date(u.unlocktime * 1000) : null,
        }));

      if (uaRows.length) {
        await this.uaRepo.upsert(uaRows, ['userId', 'gameId', 'apiName']);
      }
    }

    await this.syncFriends(steamId64, userId);
    return { games: owned.length };
  }

  // 안전하게 friend_since 추출(설정되지 않았으면 undefined)
  private friendSinceOf(x: unknown): number | undefined {
    if (typeof x !== 'object' || x === null) return undefined;
    const v = (x as Record<string, unknown>).friend_since;
    return typeof v === 'number' ? v : undefined;
  }

  private async syncFriends(steamId64: string, userId: number) {
    const list = await this.steam.getFriendList(steamId64);
    this.logger.log(`[friends] rawFromAPI=${list.length} userId=${userId}`);

    const friendsOnly = list; // 이미 relationship === 'friend'
    const steamIds = friendsOnly.map((f) => f.steamid); // 문자열로 유지
    this.logger.log(
      `[friends] parsedFriends=${friendsOnly.length}, ids=${steamIds.length}`,
    );

    if (steamIds.length === 0) {
      this.logger.log(`[friends] no friends to upsert for userId=${userId}`);
      return;
    }

    // TODO: User.steamId가 number인 현 상태에선 정확 매칭 불가(정밀도 문제).
    // 우선 friendId는 null로 두고, 이후 User.steamId를 string으로 이관하면서 매핑 구현.
    const bySteamId = new Map<string, number>();

    const rows: Array<Partial<Friend>> = friendsOnly.map((f) => {
      const sid = f.steamid; // 문자열
      const since = this.friendSinceOf(f);
      return {
        userId,
        friendSteamId: sid,
        friendId: bySteamId.get(sid) ?? null,
        friendSince: since ? new Date(since * 1000) : null,
      };
    });

    await this.friendsRepo.upsert(rows, ['userId', 'friendSteamId']);
    this.logger.log(`[friends] upserted=${rows.length}, userId=${userId}`);
  }

  async syncOneGame(steamId: string | number, userId: number, appId: number) {
    const [schema, psRaw] = await Promise.all([
      this.steam.getSchemaForGame(appId),
      // SteamApiService의 시그니처에 맞게 (appId, steamId)
      this.steam.getPlayerAchievements(appId, String(steamId)),
    ]);

    await this.gameRepo.upsert({ gameId: appId }, ['gameId']);

    const achs = schema.availableGameStats?.achievements ?? [];
    if (achs.length) {
      const rows: Partial<Achievement>[] = achs.map((a: AchievementSchema) => ({
        gameId: appId,
        apiName: a.name,
        displayName: a.displayName ?? a.name,
        hidden: !!a.hidden,
        icon: a.icon,
        iconGray: a.icongray,
      }));
      await this.achRepo.upsert(rows, ['gameId', 'apiName']);
    }

    // any/unknown 안전 처리
    const psUnknown: unknown = psRaw;
    const achievementsArr: unknown[] = isPlayerStatsResponse(psUnknown)
      ? (psUnknown.playerstats?.achievements ?? [])
      : [];

    const playerAchs: SimpleAchievement[] = [];
    for (const it of achievementsArr) {
      const a = toAchievement(it);
      if (a) playerAchs.push(a);
    }

    if (playerAchs.length) {
      const uaRows: Partial<UserAchievement>[] = playerAchs
        .filter((a) => a.achieved === 1)
        .map((a) => ({
          userId,
          gameId: appId,
          apiName: a.apiname,
          achieved: true,
          unlockedAt: a.unlocktime ? new Date(a.unlocktime * 1000) : null,
        }));
      if (uaRows.length) {
        await this.uaRepo.upsert(uaRows, ['userId', 'gameId', 'apiName']);
      }
    }

    return { gameId: appId };
  }

  // 업적 목록 + 내 달성여부 + 글로벌 달성률 조회
  async getGameAchievementsForUser(userId: number, appId: number) {
    const order: FindOptionsOrder<Achievement> = { displayName: 'ASC' };

    const [achs, uas, globals] = await Promise.all([
      this.achRepo.find({
        where: { gameId: appId },
        select: [
          'gameId',
          'apiName',
          'displayName',
          'hidden',
          'icon',
          'iconGray',
        ] as (keyof Achievement)[],
        order,
      }),
      this.uaRepo.find({
        where: { userId, gameId: appId },
        select: ['apiName'] as (keyof UserAchievement)[],
      }),
      this.steam.getGlobalAchievementPercentages(appId),
    ]);

    const achievedSet = new Set(uas.map((u) => u.apiName));
    const percentMap = new Map(globals.map((g) => [g.name, g.percent]));

    const items = achs.map((a) => ({
      apiName: a.apiName,
      displayName: a.displayName,
      hidden: !!a.hidden,
      icon: a.icon,
      iconGray: a.iconGray,
      achieved: achievedSet.has(a.apiName),
      percent: percentMap.get(a.apiName) ?? null,
    }));

    const total = achs.length;
    const completed = uas.length;
    const percent = total ? Math.round((completed / total) * 10000) / 100 : 0;

    return { gameId: appId, total, completed, percent, items };
  }
}
