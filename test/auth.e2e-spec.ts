import { INestApplication } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { SteamAuthController } from '../src/auth/auth.controller';
import { AuthController } from '../src/auth/auth.controller';
import { SteamOpenIdService } from '../src/auth/steam-openid.service';
import { UsersRepository } from '../src/domain/users/users.repository';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { REDIS } from 'src/infra/redis/redis.constants';
import { FriendsService } from '../src/domain/friends/friends.service';
import { UpsertService } from '../src/api/upsert.service';
import axios from 'axios';
import { Server } from 'http';
import { OwnedGameRepository } from 'src/domain/games/owned-game.repository';
import { CacheAsideService } from 'src/common/cache/cache-aside.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockUpsertService = {
  syncUserAll: jest.fn().mockResolvedValue(undefined),
};

// ✅ Mock CacheManager
const mockCache = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

// ✅ Redis Mock
class MockRedis {
  private store = new Map<string, { value: string; exp?: number }>();
  private now() {
    return Date.now();
  }
  private isExpired(key: string): boolean {
    const rec = this.store.get(key);
    if (!rec) return false;
    if (rec.exp && rec.exp <= this.now()) {
      this.store.delete(key);
      return true;
    }
    return false;
  }
  set(key: string, value: string, ...args: unknown[]): 'OK' | null {
    let exSec: number | undefined;
    let nx = false;

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === 'EX') {
        exSec = Number(args[i + 1]);
        i++;
      } else if (a === 'NX') {
        nx = true;
      }
    }

    if (nx && this.store.has(key) && !this.isExpired(key)) return null;
    const exp = exSec ? this.now() + exSec * 1000 : undefined;
    this.store.set(key, { value, exp });
    return 'OK';
  }
  get(key: string): string | null {
    if (this.isExpired(key)) return null;
    return this.store.get(key)?.value ?? null;
  }
  del(key: string): 1 | 0 {
    return this.store.delete(key) ? 1 : 0;
  }
  multi() {
    const ops: Array<() => [null, 'OK' | 1 | 0]> = [];
    const builder = {
      set: (key: string, value: string, ...flags: unknown[]) => {
        // consume flags to avoid no-unused-vars
        void flags.length;
        ops.push(() => {
          const v = this.set(key, value, ...flags);
          return [null, (v ?? 'OK') as 'OK'];
        });
        return builder;
      },
      del: (key: string) => {
        ops.push(() => [null, this.del(key)]);
        return builder;
      },
      exec: async (): Promise<[null, 'OK' | 1 | 0][]> => {
        // satisfy require-await
        await Promise.resolve();
        const out = ops.map((fn) => fn());
        ops.length = 0;
        return out;
      },
    };
    return builder;
  }
  on(..._args: unknown[]): void {
    void _args; // ✅ value is never read 방지
  }
}

const usersRepoMock: Pick<UsersRepository, 'upsertBySteamId'> = {
  upsertBySteamId: async (steamId: string, patch?: unknown) => {
    // satisfy require-await
    await Promise.resolve();
    const p =
      patch && typeof patch === 'object'
        ? (patch as { personaName?: string | null; avatar?: string | null })
        : {};
    return {
      id: 1,
      steamId,
      personaName: p.personaName ?? null,
      avatar: p.avatar ?? null,
    };
  },
} as unknown as UsersRepository;

const ownedRepoMock: Partial<OwnedGameRepository> = {
  fetchOwnedGamesAsRows: async (
    ..._args: Parameters<OwnedGameRepository['fetchOwnedGamesAsRows']>
  ): Promise<
    Awaited<ReturnType<OwnedGameRepository['fetchOwnedGamesAsRows']>>
  > => {
    void _args;
    await Promise.resolve();
    return {
      games: [],
      owned: [],
    } as Awaited<ReturnType<OwnedGameRepository['fetchOwnedGamesAsRows']>>;
  },

  // upsertGames(user, rows)
  upsertGames: async (
    ..._args: Parameters<OwnedGameRepository['upsertGames']>
  ): Promise<Awaited<ReturnType<OwnedGameRepository['upsertGames']>>> => {
    void _args;
    await Promise.resolve();
    return undefined as Awaited<ReturnType<OwnedGameRepository['upsertGames']>>;
  },

  // upsertOwnedMany(user, rows)
  upsertOwnedMany: async (
    ..._args: Parameters<OwnedGameRepository['upsertOwnedMany']>
  ): Promise<Awaited<ReturnType<OwnedGameRepository['upsertOwnedMany']>>> => {
    void _args;
    await Promise.resolve();
    return undefined as Awaited<
      ReturnType<OwnedGameRepository['upsertOwnedMany']>
    >;
  },
};

const cachePassThrough: Pick<
  CacheAsideService,
  'getOrLoad' | 'invalidateByIndex'
> = {
  getOrLoad: async <T>(_key: string, loader: () => Promise<T>) => loader(),
  invalidateByIndex: async () => {},
};

const configMock: Pick<ConfigService, 'get' | 'getOrThrow'> = {
  getOrThrow: (k: string) => {
    switch (k) {
      case 'STEAM_REALM':
        return 'http://localhost:3000';
      case 'STEAM_RETURN_TO':
        return 'http://localhost:3000/api/v1/auth/steam/callback';
      case 'JWT_ACCESS_SECRET':
        return 'access-secret';
      case 'JWT_REFRESH_SECRET':
        return 'refresh-secret';
      default:
        throw new Error(`Missing config: ${k}`);
    }
  },
  get: (k: string, d?: unknown) => {
    switch (k) {
      case 'JWT_EXPIRES_IN':
        return '900';
      case 'JWT_REFRESH_EXPIRES_IN':
        return '259200';
      case 'STEAM_API_KEY':
        return 'dummy-key';
      default:
        return d;
    }
  },
};

// 안전한 Set-Cookie 파서
function firstCookie(header: unknown): string {
  if (Array.isArray(header)) {
    const first = header.find((v): v is string => typeof v === 'string') ?? '';
    return first.split(';', 1)[0];
  }
  if (typeof header === 'string') {
    return header.split(';', 1)[0];
  }
  return '';
}

describe('Auth e2e flow', () => {
  let app: INestApplication;
  let server: Server;
  let redis: MockRedis;

  beforeAll(async () => {
    redis = new MockRedis();

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({}),
        CacheModule.register(), // ✅ 캐시 모듈 등록
      ],
      controllers: [SteamAuthController, AuthController],
      providers: [
        SteamOpenIdService,
        { provide: REDIS, useValue: redis },
        { provide: 'REDIS', useExisting: REDIS },
        { provide: UsersRepository, useValue: usersRepoMock },
        { provide: UpsertService, useValue: mockUpsertService },
        { provide: OwnedGameRepository, useValue: ownedRepoMock },
        { provide: CacheAsideService, useValue: cachePassThrough },
        { provide: ConfigService, useValue: configMock },
        { provide: CACHE_MANAGER, useValue: mockCache },
        {
          provide: FriendsService,
          useValue: {
            syncFriendsFromSteam: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1) GET /api/v1/auth/steam -> 302 redirect with state/nonce', async () => {
    const res = await request(server).get('/api/v1/auth/steam').expect(302);
    const loc = res.headers['location'];
    expect(loc).toContain('https://steamcommunity.com/openid/login');
    const rtStr = new URL(loc).searchParams.get('openid.return_to') ?? '';
    const rt = new URL(rtStr);
    expect(rt.pathname).toBe('/api/v1/auth/steam/callback');
    expect(rt.searchParams.has('state')).toBe(true);
    expect(rt.searchParams.has('nonce')).toBe(true);
  });

  it('2) GET /api/v1/auth/steam/callback -> 200 with tokens', async () => {
    await redis
      .multi()
      .set('oid:state:s123', '1')
      .set('oid:nonce:n123', '1')
      .exec();

    mockedAxios.post.mockResolvedValueOnce({ data: 'is_valid:true' });
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        response: {
          players: [{ personaname: 'Alice', avatarfull: 'https://avatar' }],
        },
      },
    });

    const claimed = 'https://steamcommunity.com/openid/id/76561198000000000';
    const res = await request(server)
      .get('/api/v1/auth/steam/callback')
      .query({
        'openid.mode': 'id_res',
        'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
        'openid.return_to':
          'http://localhost:3000/api/v1/auth/steam/callback?state=s123&nonce=n123',
        'openid.claimed_id': claimed,
        'openid.identity': claimed,
        'openid.response_nonce': '2025-09-29T13:00:00Zxyz',
        'openid.signed':
          'op_endpoint,claimed_id,identity,return_to,response_nonce',
        'openid.sig': 'dummy',
        'openid.ns': 'http://specs.openid.net/auth/2.0',
      })
      .expect(302);
    expect(res.headers['location']).toContain('/dashboard');
    const setCookie = res.get('set-cookie') as string[] | undefined;
    const joined = Array.isArray(setCookie)
      ? setCookie.join('\n')
      : String(setCookie || '');
    expect(joined).toMatch(/refresh_token=/);
  });

  it('3) POST /api/v1/auth/steam/refresh -> 200 rotate success', async () => {
    await redis
      .multi()
      .set('oid:state:s456', '1')
      .set('oid:nonce:n456', '1')
      .exec();

    mockedAxios.post.mockResolvedValueOnce({ data: 'is_valid:true' });
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        response: {
          players: [{ personaname: 'Bob', avatarfull: 'https://avatar2' }],
        },
      },
    });

    const claimed = 'https://steamcommunity.com/openid/id/76561198000000001';
    const cb = await request(server)
      .get('/api/v1/auth/steam/callback')
      .query({
        'openid.mode': 'id_res',
        'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
        'openid.return_to':
          'http://localhost:3000/api/v1/auth/steam/callback?state=s456&nonce=n456',
        'openid.claimed_id': claimed,
        'openid.identity': claimed,
        'openid.response_nonce': '2025-09-29T13:10:00Zabc',
        'openid.signed':
          'op_endpoint,claimed_id,identity,return_to,response_nonce',
        'openid.sig': 'dummy',
        'openid.ns': 'http://specs.openid.net/auth/2.0',
      })
      .expect(302);

    const rawSetCookie: unknown = cb.get('set-cookie');
    const cookie = firstCookie(rawSetCookie);

    const res = await request(server)
      .post('/api/v1/auth/steam/refresh')
      .set('Cookie', cookie)
      .expect(200);

    const body = res.body as unknown as {
      tokenType: string;
      accessToken: string;
    };
    expect(body.tokenType).toBe('Bearer');
    expect(typeof body.accessToken).toBe('string');
  });
});
