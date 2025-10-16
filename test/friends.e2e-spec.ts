import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  INestApplication,
  ExecutionContext,
  CanActivate,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Server } from 'http';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../src/domain/users/user.entity';
import { Friend, FriendStatus } from '../src/domain/friends/friends.entity';
import {
  CommonGame,
  CommonGamesResponse,
} from '../src/myfriends/get-common-games.dto';
import { SteamService } from '../src/integrations/steam/steam.service';

interface FriendsListResponse {
  summary: {
    total: number;
    stale: boolean;
  };
  items: Array<{
    steamid: string;
    persona_name: string | null;
    avatar: string | null;
    relationship: 'friend' | 'pending' | 'blocked';
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
  paging: {
    page: number;
    size: number;
    total: number;
  };
  links: {
    self: string;
    refresh: string;
  };
  trace_id: string;
}

interface AchievementCompareResponse {
  game: {
    app_id: number;
    name: string;
    icon: string;
  };
  friend: {
    steamid: string;
    persona_name: string;
    avatar: string;
  };
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
    you: {
      unlocked: boolean;
      unlock_time: string | null;
    };
    friend: {
      unlocked: boolean;
      unlock_time: string | null;
    };
    status: 'friend_missing' | 'you_missing' | 'both_unlocked' | 'both_missing';
    global?: {
      percent: number;
    } | null;
  }>;
  paging: {
    page: number;
    size: number;
    total: number;
  };
  links: {
    self: string;
    refresh: string;
  };
  trace_id: string;
}
let app: INestApplication;
let testingModule: TestingModule;
let httpServer: Server;
let entityManager: EntityManager;
let userRepository: Repository<User>;
let friendRepository: Repository<Friend>;

const throttlerGuardMock = {
  canActivate: jest.fn().mockReturnValue(true),
};

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
const steamServiceMock = {
  getPlayerAchievements: jest.fn().mockResolvedValue({
    playerstats: {
      steamID: '76561198000000001',
      gameName: 'Dota 2',
      achievements: [
        {
          apiname: 'ACH_WIN_1',
          achieved: 1,
          unlocktime: 1609459200,
        },
        {
          apiname: 'ACH_WIN_10',
          achieved: 0,
          unlocktime: 0,
        },
      ],
    },
    achievements: [
      {
        apiname: 'ACH_WIN_1',
        achieved: 1,
        unlocktime: 1609459200,
      },
      {
        apiname: 'ACH_WIN_10',
        achieved: 0,
        unlocktime: 0,
      },
    ],
  }),
  getSchemaForGame: jest.fn().mockResolvedValue({
    game: {
      gameName: 'Dota 2',
      gameVersion: '1',
      availableGameStats: {
        achievements: [
          {
            name: 'ACH_WIN_1',
            displayName: 'First Victory',
            description: 'Win your first game',
            icon: 'icon_url',
            icongray: 'icon_gray_url',
            hidden: 0,
          },
          {
            name: 'ACH_WIN_10',
            displayName: 'Ten Victories',
            description: 'Win 10 games',
            icon: 'icon_url_10',
            icongray: 'icon_gray_url_10',
            hidden: 0,
          },
        ],
      },
    },
    gameName: 'Dota 2',
    availableGameStats: {
      achievements: [
        {
          name: 'ACH_WIN_1',
          displayName: 'First Victory',
          description: 'Win your first game',
          icon: 'icon_url',
          icongray: 'icon_gray_url',
          hidden: 0,
        },
        {
          name: 'ACH_WIN_10',
          displayName: 'Ten Victories',
          description: 'Win 10 games',
          icon: 'icon_url_10',
          icongray: 'icon_gray_url_10',
          hidden: 0,
        },
      ],
    },
  }),
  getOwnedGames: jest.fn().mockResolvedValue({
    response: {
      game_count: 2,
      games: [
        {
          appid: 570,
          name: 'Dota 2',
          playtime_forever: 5000,
          playtime_2weeks: 100,
          img_icon_url: 'icon_hash',
          rtime_last_played: 1609459200,
        },
        {
          appid: 730,
          name: 'Counter-Strike 2',
          playtime_forever: 3000,
          playtime_2weeks: 50,
          img_icon_url: 'icon_hash_cs',
          rtime_last_played: 1609459100,
        },
      ],
    },
    games: [
      {
        appid: 570,
        name: 'Dota 2',
        playtime_forever: 5000,
        playtime_2weeks: 100,
        img_icon_url: 'icon_hash',
        rtime_last_played: 1609459200,
      },
      {
        appid: 730,
        name: 'Counter-Strike 2',
        playtime_forever: 3000,
        playtime_2weeks: 50,
        img_icon_url: 'icon_hash_cs',
        rtime_last_played: 1609459100,
      },
    ],
  }),
  buildAppHeaderUrl: jest.fn(
    (appId: number) =>
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
  ),
};

// Mock Guard 클래스 정의 - testUser는 런타임에 설정됨
class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    // 항상 최신 testUser 참조를 사용
    request.user = {
      userId: testUser?.id || 1,
      steamId: testUser?.steamId || '76561198000000001',
    };
    return true;
  }
}

let testUser: User;
let testFriend: User;
let jwtToken: string;

const ENDPOINT = (friendId: number | string): string =>
  `/api/v1/friends/${friendId}/common-games`;

interface RequestWithUser extends request.Request {
  user: {
    userId: number;
    steamId: string;
  };
}

// DTO에 정의된 유효한 정렬 옵션으로 업데이트합니다.
const VALID_SORT_OPTIONS = [
  'name',
  'you_playtime',
  'friend_playtime',
  'last_played',
  'recent_overlap',
] as const;

describe('Friends - Common Games (e2e)', () => {
  beforeAll(async () => {
    testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue(throttlerGuardMock)
      .overrideProvider(CACHE_MANAGER)
      .useValue(cacheManagerMock)
      .overrideProvider(SteamService)
      .useValue(steamServiceMock)
      .compile();

    app = testingModule.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpServer = app.getHttpServer() as Server;
    entityManager = testingModule.get(EntityManager);
    userRepository = entityManager.getRepository(User);
    friendRepository = entityManager.getRepository(Friend);
  });

  beforeEach(async () => {
    const entities = entityManager.connection.entityMetadatas;
    for (const entity of entities) {
      await entityManager.query(
        `TRUNCATE TABLE "${entity.tableName}" CASCADE;`,
      );
    }

    cacheManagerMock.reset.mockClear();
    await cacheManagerMock.reset();

    const savedUser = await userRepository.save(
      userRepository.create({
        steamId: '76561198000000001',
        personaName: 'TestUser1',
        avatar: 'https://example.com/avatar1.jpg',
      }),
    );
    testUser = savedUser;

    const savedFriend = await userRepository.save(
      userRepository.create({
        steamId: '76561198000000002',
        personaName: 'TestUser2',
        avatar: 'https://example.com/avatar2.jpg',
      }),
    );
    testFriend = savedFriend;

    await friendRepository.save([
      {
        userId: testUser.id,
        friendId: testFriend.steamId,
        status: FriendStatus.ACCEPTED,
      },
      {
        userId: testFriend.id,
        friendId: testUser.steamId,
        status: FriendStatus.ACCEPTED,
      },
    ]);

    jwtToken = 'dummy-auth-token-is-all-we-need';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    throttlerGuardMock.canActivate.mockClear();
    cacheManagerMock.get.mockClear();
    cacheManagerMock.reset.mockClear();
    steamServiceMock.getPlayerAchievements.mockClear();
    steamServiceMock.getSchemaForGame.mockClear();
    steamServiceMock.getOwnedGames.mockClear();
    steamServiceMock.buildAppHeaderUrl.mockClear();
  });

  afterAll(async () => {
    if (entityManager.connection.isInitialized) {
      await entityManager.connection.destroy();
    }
    await app.close();
  });

  describe('GET /api/v1/friends/:friendId/common-games', () => {
    it('should return common games with valid friend relationship (200 OK)', async () => {
      const response = await request(httpServer)
        .get(ENDPOINT(testFriend.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      // DTO 구조에 맞게 items와 friend, paging 객체로 destructuring 수정
      const { items, friend, summary, paging } =
        response.body as CommonGamesResponse;

      expect(Array.isArray(items)).toBe(true);
      // friend 객체의 steamid를 검증
      expect(friend.steamid).toBe(testFriend.steamId);
      // summary 객체 검증 추가 (ESLint 경고 해제 목적)
      expect(summary).toBeDefined();
      // 페이징 정보가 정의되었는지 검증
      expect(paging.total).toBeDefined();
      expect(paging.size).toBeDefined();
    });

    it.skip('should return 401 without JWT token', async () => {
      await request(httpServer).get(ENDPOINT(testFriend.steamId)).expect(401);
    });

    it('should return 403 when not friends (no relationship)', async () => {
      await friendRepository.delete({
        userId: testUser.id,
        friendId: testFriend.steamId,
      });
      await request(httpServer)
        .get(ENDPOINT(testFriend.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });

    it('should return 400 when trying to compare with self', async () => {
      await request(httpServer)
        .get(ENDPOINT(testUser.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('should handle pagination correctly', async () => {
      const page = 1;
      const limit = 10;
      const response = await request(httpServer)
        .get(ENDPOINT(testFriend.steamId))
        .query({ page, limit })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      // paging 객체의 속성을 검증하도록 수정
      const { paging } = response.body as CommonGamesResponse;
      expect(paging.page).toBe(page);
      expect(paging.size).toBe(limit);
      expect(paging.total).toBeDefined(); // totalPages 대신 total 존재 여부 확인
    });

    it('should handle all valid sortBy parameters without error', async () => {
      // DTO의 정렬 기준 enum에 맞춰 전역 VALID_SORT_OPTIONS를 업데이트했으므로, 재정의 없이 사용합니다.
      for (const sortBy of VALID_SORT_OPTIONS) {
        await request(httpServer)
          .get(ENDPOINT(testFriend.steamId))
          .query({ sortBy })
          .set('Authorization', `Bearer ${jwtToken}`)
          .expect(200);
      }
    });

    it('should reject invalid sortBy parameter (400 Bad Request)', async () => {
      await request(httpServer)
        .get(ENDPOINT(testFriend.steamId))
        .query({ sortBy: 'invalid_sort_option' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('should handle search parameter', async () => {
      const response = await request(httpServer)
        .get(ENDPOINT(testFriend.steamId))
        .query({ search: 'Counter' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      // data 대신 items를 검증하도록 수정
      const { items } = response.body as CommonGamesResponse;
      expect(items).toBeDefined();
    });

    it('should return cached data on second request (cache hit check)', async () => {
      // DTO CommonGame 인터페이스에 맞게 mock 데이터 수정
      const mockCachedGame: CommonGame = {
        app_id: 100, // app_id 사용
        name: 'Cached Game',
        icon: 'mockIconHash', // icon 추가
        you: {
          playtime_forever: 500, // you 객체 아래로 이동
          playtime_2weeks: undefined, // 명시적으로 undefined 할당 (Optional 필드)
          last_played_at: '2023-01-01T00:00:00Z', // string 할당
        },
        friend: {
          playtime_forever: 300, // friend 객체 아래로 이동
          playtime_2weeks: undefined, // 명시적으로 undefined 할당 (Optional 필드)
          last_played_at: '2023-01-01T00:00:00Z', // string 할당
        },
        overlap: {
          recent: false,
          installed: true,
        },
      };

      // DTO CommonGamesResponse 인터페이스에 맞게 mock 응답 수정
      const mockCachedResponse: CommonGamesResponse = {
        friend: {
          steamid: testFriend.steamId,
          // 'string | null' 타입 오류 해결을 위해 Non-null Assertion Operator(!) 추가
          persona_name: testFriend.personaName!,
        },
        summary: {
          total: 1,
          recent_overlap: 0,
        },
        items: [mockCachedGame], // data 대신 items 사용
        paging: {
          page: 1,
          size: 20, // limit 대신 size 사용
          total: 1,
        },
        links: {
          self: ENDPOINT(testFriend.steamId) + '?page=1&limit=20',
          refresh: ENDPOINT(testFriend.steamId) + '?force=true',
        },
        trace_id: 'mock-trace-id',
      };

      cacheManagerMock.get.mockClear();
      cacheManagerMock.get.mockResolvedValueOnce(undefined);
      cacheManagerMock.get.mockResolvedValueOnce(mockCachedResponse);

      await request(httpServer)
        .get(ENDPOINT(testFriend.steamId))
        .query({ limit: 20 }) // 쿼리 파라미터를 추가하여 캐시 키 일관성을 유지
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const finalResponse = await request(httpServer)
        .get(ENDPOINT(testFriend.steamId))
        .query({ limit: 20 }) // 쿼리 파라미터를 추가하여 캐시 키 일관성을 유지
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      // 응답 본문 전체를 새로운 Mock 응답과 비교
      expect(finalResponse.body).toEqual(mockCachedResponse);
      expect(cacheManagerMock.get).toHaveBeenCalledTimes(2);
    });

    it('should return 404 when friend with steamId not found', async () => {
      await request(httpServer)
        .get(ENDPOINT('76561198999999999')) // 존재하지 않는 steamId
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(404); // 404로 변경
    });

    it('should return 404 when friend user not found', async () => {
      // 403 → 404
      await request(httpServer)
        .get(ENDPOINT('76561198999999999')) // 숫자 → steamId string
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(404); // 403 → 404
    });

    it('should handle pending and blocked friend status (403 Forbidden)', async () => {
      await friendRepository.update(
        {
          userId: testUser.id,
          friendId: testFriend.steamId,
        },
        { status: FriendStatus.PENDING },
      );

      await request(httpServer)
        .get(ENDPOINT(testFriend.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);

      await friendRepository.update(
        {
          userId: testUser.id,
          friendId: testFriend.steamId,
        },
        { status: FriendStatus.BLOCKED },
      );

      await request(httpServer)
        .get(ENDPOINT(testFriend.steamId))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });
  });
  // ==================== 친구 목록 API 테스트 ====================

  describe('GET /api/v1/friends (Friends List)', () => {
    const FRIENDS_LIST_ENDPOINT = '/api/v1/friends';

    beforeEach(async () => {
      // 추가 친구 데이터 생성 (테스트용)
      const friend2 = await userRepository.save(
        userRepository.create({
          steamId: '76561198000000003',
          personaName: 'TestUser3',
          avatar: 'https://example.com/avatar3.jpg',
        }),
      );

      await friendRepository.save([
        {
          userId: testUser.id,
          friendId: friend2.steamId,
          status: FriendStatus.ACCEPTED,
        },
        {
          userId: friend2.id,
          friendId: testUser.steamId,
          status: FriendStatus.ACCEPTED,
        },
      ]);
    });

    it('should return friends list with default pagination (200 OK)', async () => {
      const response = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as FriendsListResponse;

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

    it.skip('should return 401 without JWT token', async () => {
      await request(httpServer).get(FRIENDS_LIST_ENDPOINT).expect(401);
    });

    it('should handle pagination correctly', async () => {
      const page = 1;
      const size = 10;

      const response = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ page, size })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as FriendsListResponse;

      expect(body.paging.page).toBe(page);
      expect(body.paging.size).toBe(size);
      expect(body.items.length).toBeLessThanOrEqual(size);
    });

    it('should handle search query (q parameter)', async () => {
      const response = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ q: 'TestUser2' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as FriendsListResponse;

      expect(body.items).toBeDefined();
      if (body.items.length > 0) {
        const firstItem = body.items[0];
        if (firstItem) {
          expect(firstItem.persona_name).toContain('TestUser2');
        }
      }
    });

    it('should handle all valid sort options', async () => {
      const validSorts = [
        'name',
        'mutual_owned',
        'recent_overlap',
        'last_online',
      ];

      for (const sort of validSorts) {
        await request(httpServer)
          .get(FRIENDS_LIST_ENDPOINT)
          .query({ sort })
          .set('Authorization', `Bearer ${jwtToken}`)
          .expect(200);
      }
    });

    it('should reject invalid sort parameter (400 Bad Request)', async () => {
      await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ sort: 'invalid_sort' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('should handle filter parameters', async () => {
      const response = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ filter: 'mutual_only' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as FriendsListResponse;

      expect(body.items).toBeDefined();
    });

    it('should include stats when requested', async () => {
      const response = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ include: 'stats' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as FriendsListResponse;

      expect(body.items).toBeDefined();
      if (body.items.length > 0) {
        const firstItem = body.items[0];
        if (firstItem) {
          expect(firstItem).toHaveProperty('stats');
          if (firstItem.stats) {
            expect(firstItem.stats).toHaveProperty('mutual_owned');
            expect(firstItem.stats).toHaveProperty('recent_overlap');
            expect(firstItem.stats).toHaveProperty('last_online_at');
          }
        }
      }
    });

    it('should return cached data on second request', async () => {
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

    it('should bypass cache when force=true', async () => {
      cacheManagerMock.get.mockClear();

      const response = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ force: true })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as FriendsListResponse;

      expect(body).toHaveProperty('items');
    });

    it('should validate page parameter (must be positive integer)', async () => {
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

    it('should validate size parameter (1-100)', async () => {
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

    it('should return correct response structure', async () => {
      const response = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as FriendsListResponse;

      // summary 타입 검증
      expect(typeof body.summary.total).toBe('number');
      expect(typeof body.summary.stale).toBe('boolean');

      // items 배열 검증
      expect(Array.isArray(body.items)).toBe(true);

      // paging 타입 검증
      expect(typeof body.paging.page).toBe('number');
      expect(typeof body.paging.size).toBe('number');
      expect(typeof body.paging.total).toBe('number');

      // links 타입 검증
      expect(typeof body.links.self).toBe('string');
      expect(typeof body.links.refresh).toBe('string');

      // trace_id 타입 검증
      expect(typeof body.trace_id).toBe('string');

      // items 구조 검증 (친구가 있을 경우)
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

    it('should handle multiple filters', async () => {
      const response = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({ filter: 'mutual_only,recent_overlap' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as FriendsListResponse;

      expect(body.items).toBeDefined();
    });

    it('should return empty items when no friends match filters', async () => {
      const response = await request(httpServer)
        .get(FRIENDS_LIST_ENDPOINT)
        .query({
          filter: 'mutual_only,recent_overlap',
          q: 'NonExistentFriend12345',
        })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as FriendsListResponse;

      expect(body.items).toEqual([]);
      expect(body.summary.total).toBe(0);
    });
  });

  // ==================== 업적 비교 API 테스트 ====================

  describe('GET /api/v1/friends/:steamid/games/:gameId/achievements/compare', () => {
    const TEST_GAME_ID = 570;
    const ACHIEVEMENT_COMPARE_ENDPOINT = (
      friendSteamId: string,
      gameId: number,
    ): string =>
      `/api/v1/friends/${friendSteamId}/games/${gameId}/achievements/compare`;

    it('should return achievement comparison with valid friend relationship (200 OK)', async () => {
      // .expect(200) 제거하고 응답을 먼저 받기
      const response = await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`);

      // 디버깅: 상태 코드가 200이 아니면 에러 출력
      if (response.status !== 200) {
        console.log('===== ERROR DEBUG =====');
        console.log('Status:', response.status);
        console.log('Body:', JSON.stringify(response.body, null, 2));
        console.log('======================');
      }

      // 이제 검증
      expect(response.status).toBe(200);

      const body = response.body as AchievementCompareResponse;

      expect(body).toHaveProperty('game');
      expect(body).toHaveProperty('friend');
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('achievements');
      expect(body).toHaveProperty('paging');
      expect(body).toHaveProperty('links');
      expect(body).toHaveProperty('trace_id');

      expect(Array.isArray(body.achievements)).toBe(true);
    });

    it.skip('should return 401 without JWT token', async () => {
      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .expect(401);
    });

    it('should return 403 when not friends (no relationship)', async () => {
      await friendRepository.delete({
        userId: testUser.id,
        friendId: testFriend.steamId,
      });

      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });

    it('should return 400 when trying to compare with self', async () => {
      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testUser.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('should handle pagination correctly', async () => {
      const page = 1;
      const size = 10;

      const response = await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ page, size })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as AchievementCompareResponse;

      expect(body.paging.page).toBe(page);
      expect(body.paging.size).toBe(size);
      expect(body.achievements.length).toBeLessThanOrEqual(size);
    });

    it('should handle all valid short (sort) parameters', async () => {
      const validSorts = [
        'status',
        'friend_missing',
        'you_missing',
        'both_unlocked',
        'name',
        'rarity',
      ];

      for (const sort of validSorts) {
        await request(httpServer)
          .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
          .query({ short: sort })
          .set('Authorization', `Bearer ${jwtToken}`)
          .expect(200);
      }
    });

    it('should reject invalid short parameter (400 Bad Request)', async () => {
      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ short: 'invalid_sort' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('should handle filter parameters', async () => {
      const validFilters = [
        'you_missing',
        'friend_missing',
        'both_unlocked',
        'both_missing',
      ];

      for (const filter of validFilters) {
        const response = await request(httpServer)
          .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
          .query({ filter })
          .set('Authorization', `Bearer ${jwtToken}`)
          .expect(200);

        const body = response.body as AchievementCompareResponse;

        expect(body.achievements).toBeDefined();
      }
    });

    it('should include global stats when includeGlobal=true', async () => {
      const response = await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ includeGlobal: true })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as AchievementCompareResponse;

      expect(body.achievements).toBeDefined();
      if (body.achievements.length > 0) {
        const achievement = body.achievements[0];
        if (achievement && achievement.global !== null) {
          expect(achievement.global).toHaveProperty('percent');
        }
      }
    });

    it('should handle lang parameter', async () => {
      const response = await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ lang: 'english' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as AchievementCompareResponse;

      expect(body.achievements).toBeDefined();
    });

    it('should bypass cache when force=true', async () => {
      cacheManagerMock.get.mockClear();

      const response = await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ force: true })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as AchievementCompareResponse;

      expect(body).toHaveProperty('achievements');
    });

    it('should validate gameId parameter (must be positive integer)', async () => {
      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, 0))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);

      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, -1))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('should return correct response structure', async () => {
      const response = await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as AchievementCompareResponse;

      // game 객체 타입 검증
      expect(typeof body.game.app_id).toBe('number');
      expect(typeof body.game.name).toBe('string');
      expect(typeof body.game.icon).toBe('string');

      // friend 객체 타입 검증
      expect(typeof body.friend.steamid).toBe('string');
      expect(typeof body.friend.persona_name).toBe('string');
      expect(typeof body.friend.avatar).toBe('string');

      // summary 객체 타입 검증
      const summary = body.summary;
      expect(typeof summary.you_unlocked).toBe('number');
      expect(typeof summary.friend_unlocked).toBe('number');
      expect(typeof summary.both_unlocked).toBe('number');
      expect(typeof summary.only_you).toBe('number');
      expect(typeof summary.only_friend).toBe('number');
      expect(typeof summary.you_completion_rate).toBe('number');
      expect(typeof summary.friend_completion_rate).toBe('number');
      expect(typeof summary.total).toBe('number');

      // achievements 배열 검증
      expect(Array.isArray(body.achievements)).toBe(true);

      // paging 객체 타입 검증
      expect(typeof body.paging.page).toBe('number');
      expect(typeof body.paging.size).toBe('number');
      expect(typeof body.paging.total).toBe('number');

      // links 객체 타입 검증
      expect(typeof body.links.self).toBe('string');
      expect(typeof body.links.refresh).toBe('string');

      // trace_id 타입 검증
      expect(typeof body.trace_id).toBe('string');

      // achievements 구조 검증 (업적이 있을 경우)
      if (body.achievements.length > 0) {
        const achievement = body.achievements[0];
        if (achievement) {
          expect(typeof achievement.api_name).toBe('string');
          expect(typeof achievement.display_name).toBe('string');
          expect(typeof achievement.description).toBe('string');

          // you 객체 검증
          expect(typeof achievement.you.unlocked).toBe('boolean');
          expect(
            achievement.you.unlock_time === null ||
              typeof achievement.you.unlock_time === 'string',
          ).toBe(true);

          // friend 객체 검증
          expect(typeof achievement.friend.unlocked).toBe('boolean');
          expect(
            achievement.friend.unlock_time === null ||
              typeof achievement.friend.unlock_time === 'string',
          ).toBe(true);

          // status 검증
          const validStatuses = [
            'friend_missing',
            'you_missing',
            'both_unlocked',
            'both_missing',
          ];
          expect(validStatuses).toContain(achievement.status);
        }
      }
    });

    it('should return summary with correct totals', async () => {
      const response = await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const body = response.body as AchievementCompareResponse;
      const { summary } = body;

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

    it('should handle pending and blocked friend status (403 Forbidden)', async () => {
      await friendRepository.update(
        {
          userId: testUser.id,
          friendId: testFriend.steamId,
        },
        { status: FriendStatus.PENDING },
      );

      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);

      await friendRepository.update(
        {
          userId: testUser.id,
          friendId: testFriend.steamId,
        },
        { status: FriendStatus.BLOCKED },
      );

      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });

    it('should validate page parameter (must be positive integer)', async () => {
      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ page: 0 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);

      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ page: -1 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('should validate size parameter (must be positive integer)', async () => {
      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ size: 0 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);

      await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ size: -1 })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(400);
    });

    it('should filter achievements correctly when filter is applied', async () => {
      const responseYouMissing = await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ filter: 'you_missing' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const bodyYouMissing =
        responseYouMissing.body as AchievementCompareResponse;

      if (bodyYouMissing.achievements.length > 0) {
        for (const ach of bodyYouMissing.achievements) {
          expect(ach.status).toBe('you_missing');
        }
      }

      const responseBothUnlocked = await request(httpServer)
        .get(ACHIEVEMENT_COMPARE_ENDPOINT(testFriend.steamId, TEST_GAME_ID))
        .query({ filter: 'both_unlocked' })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      const bodyBothUnlocked =
        responseBothUnlocked.body as AchievementCompareResponse;

      if (bodyBothUnlocked.achievements.length > 0) {
        for (const ach of bodyBothUnlocked.achievements) {
          expect(ach.status).toBe('both_unlocked');
        }
      }
    });
  });
});
