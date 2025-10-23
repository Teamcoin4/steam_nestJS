import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { SteamAuthController } from '../src/auth/auth.controller';
import { SteamOpenIdService } from '../src/auth/steam-openid.service';
import { UsersRepository } from '../src/domain/users/users.repository';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { REDIS } from 'src/infra/redis/redis.constants';

//axios 모킹 (OpenID check_authentication & GetPlayerSummaries)
import axios from 'axios';
import { Server } from 'http';
import { OwnedGameRepository } from 'src/domain/games/owned-game.repository';
import { CacheAsideService } from 'src/common/cache/cache-aside.service';
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const firstSetCookie = (h: unknown): string => {
  if (Array.isArray(h)) {
    const v = h[0] as unknown;
    return typeof v === 'string' ? v : '';
  }
  return typeof h === 'string' ? h : '';
};

// ioredis multi/exec 응답 튜플 타입
type ExecReply = [error: null, value: 'OK' | 1 | 0];

// 간단 Redis 목: ioredis가 쓰는 메서드만 흉내 (set/get/del/multi/exec)
// TTL, NX는 테스트가 필요한 부분만 반영
class MockRedis {
  private store = new Map<string, { value: string; exp?: number }>();

  private now() {
    return Date.now();
  }
  private isExpired(key: string) {
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

    if (nx) {
      const existed = this.store.has(key) && !this.isExpired(key);
      if (existed) return null;
    }

    const exp = exSec ? this.now() + exSec * 1000 : undefined;
    this.store.set(key, { value, exp });
    return 'OK';
  }

  get(key: string): string | null {
    if (this.isExpired(key)) return null;
    return this.store.get(key)?.value ?? null;
  }

  del(key: string): 1 | 0 {
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
  }

  multi() {
    const ops: Array<() => ExecReply> = [];

    const builder = {
      set: (key: string, value: string, ...flags: unknown[]) => {
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
      exec: (): Promise<ExecReply[]> => {
        const out = ops.map((fn) => fn());
        ops.length = 0;
        return Promise.resolve(out);
      },
    };
    return builder;
  }

  // 이벤트 리스너 시그니처
  on(..._args: unknown[]): void {
    void _args;
  }
}

const usersRepoMock: Pick<UsersRepository, 'upsertBySteamId'> = {
  upsertBySteamId: (
    steamId: number,
    patch?: { personaName?: string | null; avatar?: string | null },
  ) =>
    Promise.resolve({
      id: 1,
      steamId, // number 유지
      personaName: patch?.personaName ?? null,
      avatar: patch?.avatar ?? null,
    }),
} as unknown as UsersRepository;

const ownedRepoMock: Partial<OwnedGameRepository> = {
  fetchOwnedGamesAsRows: async (_steamKey, _user) => {
    await Promise.resolve();
    void _steamKey;
    void _user;
    return { games: [], owned: [] };
  },
  upsertGames: async () => {},
  upsertOwnedMany: async () => {},
};

const cachePassThrough: Pick<
  CacheAsideService,
  'getOrLoad' | 'invalidateByIndex'
> = {
  getOrLoad: <T>(_key: string, loader: () => Promise<T>) => loader(),
  invalidateByIndex: async (_idx: string) => {
    await Promise.resolve();
    void _idx;
  },
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

describe('Auth flow: GET /auth/steam -> GET /auth/steam/callback -> POST /auth/steam/refresh', () => {
  let app: INestApplication;
  let server: Server;
  let redis: MockRedis;

  beforeAll(async () => {
    redis = new MockRedis();

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [SteamAuthController],
      providers: [
        SteamOpenIdService,
        { provide: REDIS, useValue: redis },
        { provide: 'REDIS', useExisting: REDIS },
        { provide: UsersRepository, useValue: usersRepoMock },
        {
          provide: OwnedGameRepository,
          useValue: ownedRepoMock as OwnedGameRepository,
        },
        {
          provide: CacheAsideService,
          useValue: cachePassThrough as CacheAsideService,
        },
        { provide: ConfigService, useValue: configMock as ConfigService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as unknown as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('1) GET /api/v1/auth/steam -> 302 (Steam OP로 리다이렉트, return_to에 state/nonce 포함)', async () => {
    const res = await request(server).get('/api/v1/auth/steam').expect(302);

    const locHeader: unknown = res.headers['location'];
    const loc: string = firstSetCookie(locHeader);

    expect(loc).toContain('https://steamcommunity.com/openid/login');

    const op = new URL(loc);
    const rtStr = op.searchParams.get('openid.return_to') ?? '';
    const rt = new URL(rtStr);
    expect(rt.pathname).toBe('/api/v1/auth/steam/callback');
    expect(Boolean(rt.searchParams.get('state'))).toBe(true);
    expect(Boolean(rt.searchParams.get('nonce'))).toBe(true);
  });

  type callbackBody = {
    tokenType: 'Bearer';
    expiresIn: number;
    accessToken: string;
    user: {
      id: number;
      steamId: string;
      personaName: string | null;
      avatar: string | null;
    };
  };
  const isCallbackBody = (x: unknown): x is callbackBody => {
    if (!x || typeof x !== 'object') return false;
    const b = x as Record<string, unknown>;
    return (
      b.tokenType === 'Bearer' &&
      typeof b.expiresIn === 'number' &&
      typeof b.accessToken === 'string' &&
      typeof b.user === 'object' &&
      b.user !== null
    );
  };

  it('2) GET /api/v1/auth/steam/callback -> 200 (검증 ok, Set-Cookie refresh_tokenm JSON 바디)', async () => {
    await redis
      .multi()
      .set(`oid:state:s123`, '1')
      .set(`oid:nonce:n123`, '1')
      .exec();

    // OP 서명 검증: is_valid:true 모킹
    mockedAxios.post.mockResolvedValueOnce({
      data: 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n',
    });

    // 스팀 프로필 모킹
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
        'openid.return_to': `http://localhost:3000/api/v1/auth/steam/callback?state=s123&nonce=n123`,
        'openid.claimed_id': claimed,
        'openid.identity': claimed,
        'openid.response_nonce': '2025-09-29T13:00:00Zxyz',
        'openid.signed':
          'op_endpoint,claimed_id,identity,return_to,response_nonce',
        'openid.sig': 'dummy',
        'openid.ns': 'http://specs.openid.net/auth/2.0',
      })
      .expect(200);

    expect(isCallbackBody(res.body)).toBe(true);
    if (!isCallbackBody(res.body)) throw new Error('unexpected body');
    const body = res.body;

    //바디 검증
    const jwtRe = /^[\w-]+\.[\w-]+\.[\w-]+$/;

    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken).toMatch(jwtRe);
    expect(body.user).toEqual({
      id: 1,
      steamId: '76561198000000000',
      personaName: 'Alice',
      avatar: 'https://avatar',
    });

    const rawSetCookie: unknown = res.headers['set-cookie'];
    const setCookie = firstSetCookie(rawSetCookie);
    expect(setCookie).toContain('refresh_token=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie).toContain('Path=/api/v1');
  });

  it('3) POST /api/v1/auth/steam/refresh -> 200 (회전 성공: 새 access, 새 refresh 쿠키)', async () => {
    //먼저 콜백 한 번 더 태워서 유효한 refresh_token 쿠키 확보

    await redis
      .multi()
      .set(`oid:state:s456`, '1')
      .set(`oid:nonce:n456`, '1')
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
        'openid.return_to': `http://localhost:3000/api/v1/auth/steam/callback?state=s456&nonce=n456`,
        'openid.claimed_id': claimed,
        'openid.identity': claimed,
        'openid.response_nonce': '2025-09-29T13:10:00Zabc',
        'openid.signed':
          'op_endpoint,claimed_id,identity,return_to,response_nonce',
        'openid.sig': 'dummy',
        'openid.ns': 'http://specs.openid.net/auth/2.0',
      })
      .expect(200);

    // 콜백에서 내려온 refresh_token 쿠키 추출
    const rawSetCookie2: unknown = cb.headers['set-cookie'];
    const firstCookieStr = firstSetCookie(rawSetCookie2);
    const refreshCookie = firstCookieStr.split(';', 1)[0];
    expect(refreshCookie.startsWith('refresh_token=')).toBe(true);

    //회전 호출
    const res = await request(server)
      .post('/api/v1/auth/steam/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);

    const jwtRe = /^[\w-]+\.[\w-]+\.[\w-]+$/;
    expect(res.body && typeof res.body === 'object').toBe(true);
    const b = res.body as Record<string, unknown>;
    expect(b.tokenType).toBe('Bearer');
    expect(typeof b.accessToken).toBe('string');
    expect(String(b.accessToken)).toMatch(jwtRe);

    const rotated = res.headers['set-cookie'];
    const rotatedStr = Array.isArray(rotated)
      ? rotated.join('; ')
      : typeof rotated === 'string'
        ? rotated
        : '';
    expect(rotatedStr).toContain('refresh_token=');
    expect(rotatedStr).toContain('Path=/api/v1');
  });
});
