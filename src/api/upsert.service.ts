import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Achievement } from '../domain/achievements/achievement.entity';
import { UserAchievement } from '../domain/achievements/user-achievement.entity';
import { SteamApiService, AchievementSchema } from './steam.api.service';
import { Game } from '../domain/games/game.entity';
import { OwnedGame as OwnedGameEntity } from '../domain/games/owned-game.entity';
import { User } from '../domain/users/user.entity';
import { Friend, FriendStatus } from '../domain/friends/friends.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

type SimpleAchievement = {
  apiname: string;
  achieved: 0 | 1;
  unlockedAt?: number;
};

type PlayerStatsShape = {
  playerstats?: { achievements?: unknown[] };
};

function isPlayerStatsResponse(x: unknown): x is PlayerStatsShape {
  if (typeof x !== 'object' || x === null) return false;
  const ps = (x as Record<string, unknown>).playerstats;
  if (typeof ps !== 'object' || ps === null) return false;
  const arr = (ps as Record<string, unknown>).achievements;
  return arr === undefined || Array.isArray(arr);
}

function toAchievement(x: unknown): SimpleAchievement | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  const apiname = r.apiname;
  const achieved = r.achieved;
  const unlockedAt = r.unlockedAt;
  if (typeof apiname !== 'string') return null;
  if (achieved !== 0 && achieved !== 1 && typeof achieved !== 'number')
    return null;
  const ach: SimpleAchievement = {
    apiname,
    achieved: achieved === 0 || achieved === 1 ? achieved : achieved ? 1 : 0,
  };
  if (typeof unlockedAt === 'number') ach.unlockedAt = unlockedAt;
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
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // ✅ 전체 동기화 (기존 그대로 유지)
  async syncUserAll(steamId64: string, userId: number) {
    const owned = await this.steam.getOwnedGames(steamId64);
    for (const g of owned) {
      const appId = Number(g.appId);
      await this.gameRepo.upsert(
        { gameId: appId, title: g.name ?? String(appId) },
        ['gameId'],
      );
      await this.ownedRepo.upsert({ userId, gameId: appId }, [
        'userId',
        'gameId',
      ]);

      const schema = await this.steam.getSchemaForGame(appId);
      const achs = schema.availableGameStats?.achievements ?? [];
      if (achs.length > 0) {
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

      if (achs.length === 0) continue;

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
          unlockedAt: u.unlockedAt ? new Date(u.unlockedAt * 1000) : null,
        }));

      if (uaRows.length > 0) {
        await this.uaRepo.upsert(uaRows, ['userId', 'gameId', 'apiName']);
      }
    }

    await this.syncFriends(steamId64, userId);
    await this.cacheManager.set(`user:${userId}:synced`, true, 300);
    this.logger.log(`[cache] user:${userId}:synced cached for 5m`);
    return { games: owned.length };
  }

  // ✅ 신규 추가: 단일 게임만 동기화 (컨트롤러에서 사용)
  async syncOneGame(
    steamId: string,
    userId: number,
    appId: number,
  ): Promise<{ gameId: number }> {
    try {
      // 1️⃣ Game 테이블 upsert
      await this.gameRepo.upsert({ gameId: appId }, ['gameId']);

      // 2️⃣ 업적 스키마 불러오기
      const schema = await this.steam.getSchemaForGame(appId);
      const achievements = schema.availableGameStats?.achievements ?? [];
      if (achievements.length > 0) {
        const achRows: Partial<Achievement>[] = achievements.map(
          (a: AchievementSchema) => ({
            gameId: appId,
            apiName: a.name,
            displayName: a.displayName ?? a.name,
            hidden: !!a.hidden,
            icon: a.icon,
            iconGray: a.icongray,
          }),
        );
        await this.achRepo.upsert(achRows, ['gameId', 'apiName']);
      }

      // 3️⃣ 플레이어 업적
      const psRaw = await this.steam.getPlayerAchievements(appId, steamId);
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
        .filter((a) => a.achieved === 1)
        .map((a) => ({
          userId,
          gameId: appId,
          apiName: a.apiname,
          achieved: true,
          unlockedAt:
            typeof a.unlockedAt === 'number'
              ? new Date(a.unlockedAt * 1000)
              : null,
        }));

      if (uaRows.length > 0) {
        await this.uaRepo.upsert(uaRows, ['userId', 'gameId', 'apiName']);
      }

      this.logger.log(
        `[syncOneGame] user:${userId} appId:${appId} synced=${uaRows.length}`,
      );
      return { gameId: appId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      this.logger.error(
        `[syncOneGame] Failed for user:${userId}, appId:${appId} — ${message}`,
      );
      throw new NotFoundException(`Steam sync failed: ${message}`);
    }
  }

  // ✅ 친구 목록 동기화 (기존 그대로 유지)
  private async syncFriends(steamId64: string, userId: number) {
    const list = await this.steam.getFriendList(steamId64);
    if (!list.length) {
      this.logger.log(`[friends] no friends to upsert for userId=${userId}`);
      return;
    }
    const rows: Array<Partial<Friend>> = list.map((f) => ({
      userId,
      friendId: f.steamid,
      friend_since:
        typeof f.friend_since === 'number'
          ? new Date(f.friend_since * 1000)
          : null,
      status: FriendStatus.ACCEPTED,
    }));
    await this.friendsRepo.upsert(rows, ['userId', 'friendId']);
    this.logger.log(`[friends] upserted=${rows.length}, userId=${userId}`);
  }
}
