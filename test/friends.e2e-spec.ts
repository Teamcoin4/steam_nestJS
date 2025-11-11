// test/friends.e2e.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import type { Server } from 'http';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SteamService } from '../src/integrations/steam/steam.service';

import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { User } from '../src/domain/users/user.entity';
import { Friend, FriendStatus } from '../src/domain/friends/friends.entity';
import { INestApplication } from '@nestjs/common';
import {
  CommonGame,
  CommonGamesResponse,
} from '../src/myfriends/get-common-games.dto';
import { MockJwtAuthGuard } from '../mocks/jwt-auth.guard.mock';
import { getDataSourceToken } from '@nestjs/typeorm';

/** -------- Types (API Response) -------- */
interface FriendsListResponse {
  summary: { total: number; stale: boolean };
  items: Array<{
    steamid: string;
    persona_name: string | null;
    avatar: string | null;
    relationship: 'accepted' | 'pending' | 'blocked';
    stats?: {
      mutual_owned: number;
      recent_overlap: number;
      last_online_at: string;
    };
    links: {
      profile: string;
      common_games: string;
      compare_achievements: string;
    };
  }>;
  paging: { page: number; size: number; total: number };
  links: { self: string; refresh: string };
  trace_id: string;
}

interface AchievementCompareResponse {
  game: { app_id: number; name: string; icon: string };
  friend: { steamid: string; persona_name: string; avatar: string };
  summary: {
    you_unlocked: number;
    friend_unlocked: number;
    both_unlocked: number;
    only_you: number;
    only_friend: number;
    you_completion_rate: number;
    friend_completion_rate: number;
    total: number;
  };
  achievements: Array<{
    api_name: string;
    display_name: string;
    description: string;
    you: { unlocked: boolean; unlock_time: string | null };
    friend: { unlocked: boolean; unlock_time: string | null };
    status: 'friend_missing' | 'you_missing' | 'both_unlocked' | 'both_missing';
    global?: { percent: number } | null;
  }>;
  paging: { page: number; size: number; total: number };
  links: { self: string; refresh: string };
  trace_id: string;
}

/** -------- Globals -------- */
let httpServer!: Server;
let userRepository!: Repository<User>;
let friendRepository!: Repository<Friend>;
let dataSource!: DataSource;
let app: INestApplication;

let testUser: User;
let testFriend: User;
let jwtToken!: string;

interface MockCache {
  get: jest.MockedFunction<(key: string) => Promise<unknown>>;
  set: jest.MockedFunction<
    (key: string, value: unknown, ttl?: number) => Promise<void>
  >;
  reset: jest.MockedFunction<() => Promise<void>>;
  del: jest.MockedFunction<(key: string) => Promise<void>>;
}
const cacheManagerMock: MockCache = {
  get: jest.fn(),
  set: jest.fn(),
  reset: jest.fn(),
  del: jest.fn(),
};

// SteamService Mock - Jest Mock 함수 사용으로 ESLint 경고 해결
const steamServiceMock: Pick<
  SteamService,
  | 'getPlayerAchievements'
  | 'getSchemaForGame'
  | 'getOwnedGames'
  | 'buildAppHeaderUrl'
> = {
  getPlayerAchievements: jest.fn().mockResolvedValue({
    achievements: [
      { apiname: 'ACH_WIN_1', achieved: 1, unlockedAt: 1609459200 },
      { apiname: 'ACH_WIN_10', achieved: 0, unlockedAt: 0 },
    ],
  }),

  getSchemaForGame: jest.fn().mockResolvedValue({
    gameName: 'Dota 2',
    gameVersion: '1',
    availableGameStats: {
      achievements: [
        {
          name: 'ACH_WIN_1',
          defaultvalue: 0,
          displayName: 'First Victory',
          hidden: 0,
          description: 'Win your first game',
          icon: 'icon_url',
          icongray: 'icon_gray_url',
        },
        {
          name: 'ACH_WIN_10',
          defaultvalue: 0,
          displayName: 'Ten Victories',
          hidden: 0,
          description: 'Win 10 games',
          icon: 'icon_url_10',
          icongray: 'icon_gray_url_10',
        },
      ],
    },
  }),

  getOwnedGames: jest.fn().mockResolvedValue({
    games: [
      {
        appId: 570,
        name: 'Dota 2',
        playtime_forever: 5000,
        playtime_2weeks: 100,
        img_icon_url: 'icon_hash',
        rtime_last_played: 1609459200,
        has_community_visible_stats: true,
      },
      {
        appId: 730,
        name: 'Counter-Strike 2',
        playtime_forever: 3000,
        playtime_2weeks: 50,
        img_icon_url: 'icon_hash_cs',
        rtime_last_played: 1609459100,
        has_community_visible_stats: true,
      },
    ],
  }),

  buildAppHeaderUrl: (appId: number) =>
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
};

/** -------- Helpers -------- */
const API = {
  root: '/api/v1',
  friends: '/api/v1/friends',
  commonGames: (steamid: string | number) =>
    `/api/v1/friends/${steamid}/common-games`,
  achvCompare: (steamid: string, gameId: number) =>
    `/api/v1/friends/${steamid}/games/${gameId}/achievements/compare`,
};

/** Truncate all tables safely (FK cascade-aware) */
async function truncateAll(ds: DataSource) {
  const tableNames = ds.entityMetadatas
    .map((entity) => `"${entity.tableName}"`)
    .join(', ');

  if (tableNames.length > 0) {
    await ds.query(`
      TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;
    `);
  }
}

/** -------- Bootstrapping -------- */
beforeAll(async () => {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(MockJwtAuthGuard)
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .overrideProvider(SteamService)
    .useValue(steamServiceMock)
    .overrideProvider(CACHE_MANAGER)
    .useValue(cacheManagerMock)
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: [] });
  await app.init();

  httpServer = app.getHttpServer() as unknown as Server;
  dataSource = moduleRef.get<DataSource>(getDataSourceToken());
  userRepository = dataSource.getRepository(User);
  friendRepository = dataSource.getRepository(Friend);

  await truncateAll(dataSource);

  testUser = await userRepository.save(
    userRepository.create({
      steamId: '76561198000000001',
      personaName: 'TestUser1',
      avatar: 'https://example.com/avatar1.jpg',
    }),
  );

  testFriend = await userRepository.save(
    userRepository.create({
      steamId: '76561198000000002',
      personaName: 'TestUser2',
      avatar: 'https://example.com/avatar2.jpg',
    }),
  );

  jwtToken = 'mocked-token';
});

afterAll(async () => {
  await app.close();
});

/** -------- Test Suite -------- */
describe('Friends E2E (fixed)', () => {
  beforeEach(async () => {
    await truncateAll(dataSource);

    testUser = await userRepository.save(
      userRepository.create({
        steamId: '76561198000000001',
        personaName: 'TestUser1',
      }),
    );

    testFriend = await userRepository.save(
      userRepository.create({
        steamId: '76561198000000002',
        personaName: 'TestUser2',
      }),
    );

    await friendRepository.save([
      friendRepository.create({
        userId: testUser.id,
        friendId: testFriend.steamId,
        status: FriendStatus.ACCEPTED,
      }),
      friendRepository.create({
        userId: testFriend.id,
        friendId: testUser.steamId,
        status: FriendStatus.ACCEPTED,
      }),
    ]);
  });

  /** -------- Common Games -------- */
  describe('GET /friends/:steamid/common-games', () => {
    const VALID_SORT_OPTIONS = [
      'name',
      'you_playtime',
      'friend_playtime',
      'last_played',
      'recent_overlap',
    ] as const;

    it('200: returns common games for a valid friend', async () => {
      const res = await request(httpServer)
        .get(API.commonGames(testFriend.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const { items, friend, summary, paging } =
        res.body as CommonGamesResponse;
      expect(Array.isArray(items)).toBe(true);
      expect(friend.steamid).toBe(testFriend.steamId);
      expect(summary).toBeDefined();
      expect(paging.size).toBeDefined();
      expect(paging.total).toBeDefined();
    });

    it('403: not friends', async () => {
      await friendRepository.delete({
        userId: testUser.id,
        friendId: testFriend.steamId,
      });
      await request(httpServer)
        .get(API.commonGames(testFriend.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });

    it('400: compare with self', async () => {
      await request(httpServer)
        .get(API.commonGames(testUser.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('200: pagination', async () => {
      const page = 1;
      const limit = 10;
      const res = await request(httpServer)
        .get(API.commonGames(testFriend.steamId))
        .query({ page, limit })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const { paging } = res.body as CommonGamesResponse;
      expect(paging.page).toBe(page);
      expect(paging.size).toBe(limit);
      expect(paging.total).toBeDefined();
    });

    it('200: all valid sortBy accepted', async () => {
      for (const sortBy of VALID_SORT_OPTIONS) {
        await request(httpServer)
          .get(API.commonGames(testFriend.steamId))
          .query({ sortBy })
          .set('Authorization', `Bearer ${jwtToken}`)
          .expect(200);
      }
    });

    it('400: invalid sortBy', async () => {
      await request(httpServer)
        .get(API.commonGames(testFriend.steamId))
        .query({ sortBy: 'invalid_sort' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('200: search filter works', async () => {
      const res = await request(httpServer)
        .get(API.commonGames(testFriend.steamId))
        .query({ search: 'Counter' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const { items } = res.body as CommonGamesResponse;
      expect(items).toBeDefined();
    });

    it('returns cached data on second request', async () => {
      const mockCachedGame: CommonGame = {
        app_id: 100,
        name: 'Cached Game',
        icon: 'mockIconHash',
        you: {
          playtime_forever: 500,
          playtime_2weeks: undefined,
          last_played_at: '2023-01-01T00:00:00Z',
        },
        friend: {
          playtime_forever: 300,
          playtime_2weeks: undefined,
          last_played_at: '2023-01-01T00:00:00Z',
        },
        overlap: { recent: false, installed: true },
      };

      const mockCachedResponse: CommonGamesResponse = {
        friend: {
          steamid: testFriend.steamId,
          persona_name: testFriend.personaName ?? 'TestUser2',
        },
        summary: { total: 1, recent_overlap: 0 },
        items: [mockCachedGame],
        paging: { page: 1, size: 20, total: 1 },
        links: {
          self: `${API.commonGames(testFriend.steamId)}?page=1&limit=20`,
          refresh: `${API.commonGames(testFriend.steamId)}?force=true`,
        },
        trace_id: 'mock-trace-id',
      };

      cacheManagerMock.get.mockClear();
      cacheManagerMock.get.mockResolvedValueOnce(undefined);
      cacheManagerMock.get.mockResolvedValueOnce(mockCachedResponse);

      await request(httpServer)
        .get(API.commonGames(testFriend.steamId))
        .query({ limit: 20 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const finalRes = await request(httpServer)
        .get(API.commonGames(testFriend.steamId))
        .query({ limit: 20 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(finalRes.body).toEqual(mockCachedResponse);
      expect(cacheManagerMock.get).toHaveBeenCalledTimes(2);
    });

    it('404: friend steamId not found', async () => {
      await request(httpServer)
        .get(API.commonGames('76561198999999999'))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(404);
    });

    it('403: pending/blocked are forbidden', async () => {
      await friendRepository.update(
        { userId: testUser.id, friendId: testFriend.steamId },
        { status: FriendStatus.PENDING },
      );
      await request(httpServer)
        .get(API.commonGames(testFriend.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);

      await friendRepository.update(
        { userId: testUser.id, friendId: testFriend.steamId },
        { status: FriendStatus.BLOCKED },
      );
      await request(httpServer)
        .get(API.commonGames(testFriend.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });
  });

  /** -------- Friends List -------- */
  describe('GET /friends (list)', () => {
    const FRIENDS_LIST_ENDPOINT = API.friends;

    beforeEach(async () => {
      await truncateAll(dataSource);

      testUser = await userRepository.save(
        userRepository.create({
          steamId: '76561198000000001',
          personaName: 'TestUser1',
        }),
      );

      testFriend = await userRepository.save(
        userRepository.create({
          steamId: '76561198000000002',
          personaName: 'TestUser2',
        }),
      );

      await friendRepository.save([
        friendRepository.create({
          userId: testUser.id,
          friendId: testFriend.steamId,
          status: FriendStatus.ACCEPTED,
        }),
        friendRepository.create({
          userId: testFriend.id,
          friendId: testUser.steamId,
          status: FriendStatus.ACCEPTED,
        }),
      ]);
    });

    it('200: default pagination', async () => {
      const res = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = res.body as FriendsListResponse;
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('paging');
      expect(body).toHaveProperty('links');
      expect(body).toHaveProperty('trace_id');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.summary.total).toBeGreaterThan(0);
      expect(body.paging.page).toBe(1);
      expect(body.paging.size).toBe(30);
    });

    it('200: pagination works', async () => {
      const page = 1;
      const size = 10;
      const res = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ page, size })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as FriendsListResponse;
      expect(body.paging.page).toBe(page);
      expect(body.paging.size).toBe(size);
      expect(body.items.length).toBeLessThanOrEqual(size);
    });

    it('200: search (q) works', async () => {
      const res = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ q: 'TestUser2' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = res.body as FriendsListResponse;
      expect(body.items).toBeDefined();
      if (body.items.length > 0) {
        const first = body.items[0];
        if (first) {
          expect(first.persona_name).toContain('TestUser2');
        }
      }
    });

    it('200: all valid sort options', async () => {
      const validSorts = [
        'name',
        'mutual_owned',
        'recent_overlap',
        'last_online',
      ] as const;
      for (const sort of validSorts) {
        await request(httpServer)
          .get(FRIENDS_LIST_ENDPOINT)
          .query({ sort })
          .set('Authorization', `Bearer ${jwtToken}`)
          .expect(200);
      }
    });

    it('400: invalid sort', async () => {
      await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ sort: 'invalid_sort' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('200: filter param works', async () => {
      const res = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ filter: 'mutual_only' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as FriendsListResponse;
      expect(body.items).toBeDefined();
    });

    it('200: include=stats attaches stats', async () => {
      const res = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ include: 'stats' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = res.body as FriendsListResponse;
      expect(body.items).toBeDefined();
      if (body.items.length > 0) {
        const first = body.items[0];
        if (first) {
          expect(first).toHaveProperty('stats');
          if (first.stats) {
            expect(first.stats).toHaveProperty('mutual_owned');
            expect(first.stats).toHaveProperty('recent_overlap');
            expect(first.stats).toHaveProperty('last_online_at');
          }
        }
      }
    });

    it('cache: returns cached data on second request', async () => {
      cacheManagerMock.get.mockClear();
      await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      expect(cacheManagerMock.get).toHaveBeenCalled();
    });

    it('force=true bypasses cache', async () => {
      cacheManagerMock.get.mockClear();
      const res = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ force: true })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as FriendsListResponse;
      expect(body).toHaveProperty('items');
    });

    it('validates page', async () => {
      await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ page: 0 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
      await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ page: -1 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
      await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ page: 'abc' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('validates size', async () => {
      await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ size: 0 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
      await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ size: 101 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('response shape is correct', async () => {
      const res = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as FriendsListResponse;

      expect(typeof body.summary.total).toBe('number');
      expect(typeof body.summary.stale).toBe('boolean');
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.paging.page).toBe('number');
      expect(typeof body.paging.size).toBe('number');
      expect(typeof body.paging.total).toBe('number');
      expect(typeof body.links.self).toBe('string');
      expect(typeof body.links.refresh).toBe('string');
      expect(typeof body.trace_id).toBe('string');

      if (body.items.length > 0) {
        const item = body.items[0];
        if (item) {
          expect(typeof item.steamid).toBe('string');
          expect(
            item.persona_name === null || typeof item.persona_name === 'string',
          ).toBe(true);
          expect(item.avatar === null || typeof item.avatar === 'string').toBe(
            true,
          );
          expect(['accepted', 'pending', 'blocked']).toContain(
            item.relationship,
          );
          expect(typeof item.links.profile).toBe('string');
          expect(typeof item.links.common_games).toBe('string');
          expect(typeof item.links.compare_achievements).toBe('string');
        }
      }
    });

    it('multiple filters work together', async () => {
      const res = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ filter: 'mutual_only,recent_overlap' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as FriendsListResponse;
      expect(body.items).toBeDefined();
    });

    it('empty result when no matches', async () => {
      const res = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({
          filter: 'mutual_only,recent_overlap',
          q: 'NonExistentFriend12345',
        })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as FriendsListResponse;
      expect(body.items).toEqual([]);
      expect(body.summary.total).toBe(0);
    });
  });

  /** -------- Achievement Compare -------- */
  describe('GET /friends/:steamid/games/:gameId/achievements/compare', () => {
    const TEST_GAME_ID = 570;

    it('200: returns comparison for a valid friend', async () => {
      const res = await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`);

      expect(res.status).toBe(200);

      const body = res.body as AchievementCompareResponse;
      expect(body).toHaveProperty('game');
      expect(body).toHaveProperty('friend');
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('achievements');
      expect(body).toHaveProperty('paging');
      expect(body).toHaveProperty('links');
      expect(body).toHaveProperty('trace_id');
      expect(Array.isArray(body.achievements)).toBe(true);
    });

    it('403: not friends', async () => {
      await friendRepository.delete({
        userId: testUser.id,
        friendId: testFriend.steamId,
      });
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });

    it('400: compare with self', async () => {
      await request(httpServer)
        .get(API.achvCompare(testUser.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('200: pagination', async () => {
      const page = 1;
      const size = 10;
      const res = await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ page, size })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = res.body as AchievementCompareResponse;
      expect(body.paging.page).toBe(page);
      expect(body.paging.size).toBe(size);
      expect(body.achievements.length).toBeLessThanOrEqual(size);
    });

    it('200: all valid "short" sort values', async () => {
      const validSorts = [
        'status',
        'friend_missing',
        'you_missing',
        'both_unlocked',
        'name',
        'rarity',
      ] as const;
      for (const sort of validSorts) {
        await request(httpServer)
          .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
          .query({ short: sort })
          .set('Authorization', `Bearer ${jwtToken}`)
          .expect(200);
      }
    });

    it('400: invalid short', async () => {
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ short: 'invalid_sort' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('200: filter values work', async () => {
      const validFilters = [
        'you_missing',
        'friend_missing',
        'both_unlocked',
        'both_missing',
      ] as const;
      for (const filter of validFilters) {
        const res = await request(httpServer)
          .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
          .query({ filter })
          .set('Authorization', `Bearer ${jwtToken}`)
          .expect(200);
        const body = res.body as AchievementCompareResponse;
        expect(body.achievements).toBeDefined();
      }
    });

    it('200: includeGlobal=true attaches global stats (if any)', async () => {
      const res = await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ includeGlobal: true })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as AchievementCompareResponse;
      expect(body.achievements).toBeDefined();
      if (body.achievements.length > 0) {
        const ach = body.achievements[0];
        if (ach && ach.global !== null) {
          expect(ach.global).toHaveProperty('percent');
        }
      }
    });

    it('200: lang param accepted', async () => {
      const res = await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ lang: 'english' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as AchievementCompareResponse;
      expect(body.achievements).toBeDefined();
    });

    it('cache bypass with force=true', async () => {
      cacheManagerMock.get.mockClear();
      const res = await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ force: true })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as AchievementCompareResponse;
      expect(body).toHaveProperty('achievements');
    });

    it('validates gameId', async () => {
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, 0))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, -1))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('response structure is correct', async () => {
      const res = await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
      const body = res.body as AchievementCompareResponse;

      expect(typeof body.game.app_id).toBe('number');
      expect(typeof body.game.name).toBe('string');
      expect(typeof body.game.icon).toBe('string');
      expect(typeof body.friend.steamid).toBe('string');
      expect(typeof body.friend.persona_name).toBe('string');
      expect(typeof body.friend.avatar).toBe('string');

      const s = body.summary;
      expect(typeof s.you_unlocked).toBe('number');
      expect(typeof s.friend_unlocked).toBe('number');
      expect(typeof s.both_unlocked).toBe('number');
      expect(typeof s.only_you).toBe('number');
      expect(typeof s.only_friend).toBe('number');
      expect(typeof s.you_completion_rate).toBe('number');
      expect(typeof s.friend_completion_rate).toBe('number');
      expect(typeof s.total).toBe('number');

      expect(Array.isArray(body.achievements)).toBe(true);
      expect(typeof body.paging.page).toBe('number');
      expect(typeof body.paging.size).toBe('number');
      expect(typeof body.paging.total).toBe('number');
      expect(typeof body.links.self).toBe('string');
      expect(typeof body.links.refresh).toBe('string');
      expect(typeof body.trace_id).toBe('string');

      if (body.achievements.length > 0) {
        const a = body.achievements[0];
        if (a) {
          expect(typeof a.api_name).toBe('string');
          expect(typeof a.display_name).toBe('string');
          expect(typeof a.description).toBe('string');
          expect(typeof a.you.unlocked).toBe('boolean');
          expect(
            a.you.unlock_time === null || typeof a.you.unlock_time === 'string',
          ).toBe(true);
          expect(typeof a.friend.unlocked).toBe('boolean');
          expect(
            a.friend.unlock_time === null ||
              typeof a.friend.unlock_time === 'string',
          ).toBe(true);
          const validStatuses = [
            'friend_missing',
            'you_missing',
            'both_unlocked',
            'both_missing',
          ] as const;
          expect(validStatuses).toContain(a.status);
        }
      }
    });

    it('summary totals are consistent', async () => {
      const res = await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const { summary } = res.body as AchievementCompareResponse;
      expect(summary.you_unlocked).toBeLessThanOrEqual(summary.total);
      expect(summary.friend_unlocked).toBeLessThanOrEqual(summary.total);
      expect(summary.both_unlocked).toBeLessThanOrEqual(
        Math.min(summary.you_unlocked, summary.friend_unlocked),
      );
      expect(summary.only_you + summary.both_unlocked).toBe(
        summary.you_unlocked,
      );
      expect(summary.only_friend + summary.both_unlocked).toBe(
        summary.friend_unlocked,
      );
      expect(summary.you_completion_rate).toBeGreaterThanOrEqual(0);
      expect(summary.you_completion_rate).toBeLessThanOrEqual(1);
      expect(summary.friend_completion_rate).toBeGreaterThanOrEqual(0);
      expect(summary.friend_completion_rate).toBeLessThanOrEqual(1);
    });

    it('403: pending/blocked are forbidden', async () => {
      await friendRepository.update(
        { userId: testUser.id, friendId: testFriend.steamId },
        { status: FriendStatus.PENDING },
      );
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);

      await friendRepository.update(
        { userId: testUser.id, friendId: testFriend.steamId },
        { status: FriendStatus.BLOCKED },
      );
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });

    it('validates page/size', async () => {
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ page: 0 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ page: -1 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ size: 0 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
      await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ size: -1 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('filters apply correctly', async () => {
      const resYouMissing = await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ filter: 'you_missing' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const bodyYouMissing = resYouMissing.body as AchievementCompareResponse;
      if (bodyYouMissing.achievements.length > 0) {
        for (const ach of bodyYouMissing.achievements) {
          expect(ach.status).toBe('you_missing');
        }
      }

      const resBothUnlocked = await request(httpServer)
        .get(API.achvCompare(testFriend.steamId, TEST_GAME_ID))
        .query({ filter: 'both_unlocked' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const bodyBoth = resBothUnlocked.body as AchievementCompareResponse;
      if (bodyBoth.achievements.length > 0) {
        for (const ach of bodyBoth.achievements) {
          expect(ach.status).toBe('both_unlocked');
        }
      }
    });
  });
});
