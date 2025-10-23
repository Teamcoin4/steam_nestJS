import {
  INestApplication,
  CanActivate,
  ExecutionContext,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { MeController } from 'src/me/me.controller';
import { MeService } from 'src/me/me.service';
import { CacheAsideService } from 'src/common/cache/cache-aside.service';
import { OwnedGameRepository } from 'src/domain/games/owned-game.repository';
import { UsersRepository } from '../src/domain/users/users.repository';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

type TestUser = { sub: number; id?: number; userId?: number };
type TestReq = Request & { user?: TestUser };

// 요청에 user.sub-1을 심어주는 허용 가드
class AllowAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TestReq>();
    req.user = { sub: 1, id: 1, userId: 1 };
    return true;
  }
}

// Throttler 항상 통과
class AllowThrottleGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

const usersRepoMock: Pick<UsersRepository, 'findById'> = {
  async findById(id: number) {
    await Promise.resolve();
    if (id === 1) {
      return {
        id,
        steamId: String('76561198000355602'),
        personaName: 'kim',
        avatar: 'https://example/avatar.jpg',
        created_at: new Date('2025-09-06T08:30:00Z'),
        updated_at: new Date('2025-09-30T09:00:00Z'),
        ownedGames: [],
        userAchievements: [],
        friends: [],
        friendedBy: [],
      };
    }
    return null;
  },
};

type SortKey = 'playtimeForever' | 'playtime2Weeks' | 'gameId' | 'name';
type OrderKey = 'asc' | 'desc';
type ListOpts = {
  sort: SortKey;
  order: OrderKey;
  page: number;
  size: number;
  keyword?: string;
  includeAch?: boolean;
};

type OwnedListItem = {
  appId: number;
  name: string;
  icon: string;
  you: {
    playtimeForever: number;
    playtime2Weeks: number;
    lastPlayedAt: Date | null;
    installed: boolean;
    hidden: boolean;
    addedAt: string | null;
  };
  achievements?:
    | {
        supported: true;
        unlocked: number;
        total: number;
        completion_rate: number;
      }
    | {
        supported: false;
        unlocked: 0;
        total: 0;
        completion_rate: 0;
      }
    | undefined;
  links: {
    game: string;
    achievements_me: string;
    achievements_defs: string;
  };
};

type ListMethod = (
  userId: number,
  opts: ListOpts,
) => Promise<{ items: OwnedListItem[]; total: number }>;

const ownedRepoMock: { listForUserQB: ListMethod } = {
  listForUserQB: async (userId, opts) => {
    await Promise.resolve();

    if (userId === -1) throw new Error('never');
    switch (opts.sort) {
      default:
        break;
    }
    const items: OwnedListItem[] = [
      {
        appId: 620,
        name: 'Portal 2',
        icon: 'icon-url',
        you: {
          playtimeForever: 1230,
          playtime2Weeks: 120,
          lastPlayedAt: new Date('2025-09-01T11:22:00Z'),
          installed: true,
          hidden: false,
          addedAt: '2024-03-21T09:10:00Z',
        },
        achievements: {
          supported: true,
          unlocked: 35,
          total: 51,
          completion_rate: 0.686,
        },
        links: {
          game: '/api/v1/games/620',
          achievements_me: '/api/v1/me/games/620/achievements',
          achievements_defs: '/api/v1/games/620/achievements',
        },
      },
    ];

    return { items, total: items.length };
  },
};

const invalidateSpy = jest.fn();
const cachePassThrough: Pick<
  CacheAsideService,
  'getOrLoad' | 'invalidateByIndex'
> = {
  getOrLoad: <T>(
    key: string,
    loader: () => Promise<T>,
    opts?: { ttlSec?: number; index?: string | string[]; lockMs?: number },
  ): Promise<T> => {
    if (typeof key !== 'string') throw new Error('never');
    if (opts && opts.ttlSec === -1) throw new Error('never');
    return loader();
  },
  invalidateByIndex: (idx: string) => {
    invalidateSpy(idx);
    return Promise.resolve();
  },
};

describe('MeController e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MeController],
      providers: [
        MeService,
        { provide: OwnedGameRepository, useValue: ownedRepoMock },
        { provide: UsersRepository, useValue: usersRepoMock },
        { provide: CacheAsideService, useValue: cachePassThrough },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AllowAuthGuard)
      .overrideGuard(ThrottlerGuard)
      .useClass(AllowThrottleGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    invalidateSpy.mockClear();
  });

  it('GET /api/v1/me -> 내 프로필 반환', async () => {
    const res = await request(app.getHttpServer() as import('http').Server)
      .get('/api/v1/me')
      .expect(200);

    expect(res.body).toEqual({
      data: {
        id: 1,
        steamId: '76561198000355602',
        personaName: 'kim',
        avatar: 'https://example/avatar.jpg',
        created_at: '2025-09-06T08:30:00.000Z',
        updated_at: '2025-09-30T09:00:00.000Z',
      },
      error: null,
    });
  });

  it('GET /api/v1/me/games -> 기본 페이징/정렬 + 아이템 스키마', async () => {
    const res = await request(app.getHttpServer() as import('http').Server)
      .get('/api/v1/me/games')
      .expect(200);

    const body = res.body as {
      page: number;
      size: number;
      total: number;
      items: OwnedListItem[];
    };

    expect(body.page).toBe(1);
    expect(body.size).toBe(30);
    expect(body.total).toBe(1);

    const item = body.items?.[0];
    expect(item).toMatchObject({
      appId: 620,
      name: 'Portal 2',
      icon: 'icon-url',
      you: {
        playtimeForever: 1230,
        playtime2Weeks: 120,
        installed: true,
        hidden: false,
        addedAt: '2024-03-21T09:10:00Z',
      },
      links: {
        game: '/api/v1/games/620',
        achievements_me: '/api/v1/me/games/620/achievements',
        achievements_defs: '/api/v1/games/620/achievements',
      },
    });
  });

  it('GET /api/v1/me/games?force=true -> 캐시 인덱스 무효화 호출', async () => {
    await request(app.getHttpServer() as import('http').Server)
      .get('/api/v1/me/games')
      .query({ force: true })
      .expect(200);

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('GET /api/v1/me/games?sort=name&order=asc&page=2&size=10&keyword=por', async () => {
    const res = await request(app.getHttpServer() as import('http').Server)
      .get('/api/v1/me/games')
      .query({ sort: 'name', order: 'asc', page: 2, size: 10, keyword: 'por' })
      .expect(200);

    const body = res.body as {
      page: number;
      size: number;
      total: number;
      items: OwnedListItem[];
    };

    expect(body.page).toBe(2);
    expect(body.size).toBe(10);
    expect(body.total).toBe(1);
  });
});
