import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CacheAsideService } from '../common/cache/cache-aside.service';
import { randomBytes, createHash } from 'crypto';
import { errorSummary } from 'src/common/error.util';
import { JwtService } from '@nestjs/jwt';
import { UsersRepository } from '../domain/users/users.repository';
import { User } from 'src/domain/users/user.entity';
import { myGamesIdx, profileIdx } from 'src/common/cache/keys';
import { OwnedGameRepository } from 'src/domain/games/owned-game.repository';
import { FriendsService } from '../domain/friends/friends.service';

const OP = 'https://steamcommunity.com/openid/login';

type PipelineResult = [err: Error | null, res: 'OK' | number | null];

interface RedisPipeline {
  set(key: string, value: string, ...args: (string | number)[]): this;
  del(key: string): this;
  exec(): Promise<PipelineResult[] | null>;
}
interface RedisLike {
  multi(): RedisPipeline;
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

// ---- Strict typings to avoid any/unsafe ----
interface RefreshPayload {
  sub: number;
  jti: string;
  typ: 'refresh';
}
interface SteamSummaries {
  response?: {
    players?: Array<{
      personaname?: string;
      avatarfull?: string;
    }>;
  };
}
interface AuthUserDto {
  id: number;
  steamId: string;
  personaName: string | null;
  avatar: string | null;
}
interface AuthResult {
  user: AuthUserDto;
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenMaxAgeMs: number;
  steamId64?: string;
}
interface TestLoginResult {
  user: AuthUserDto;
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenMaxAgeMs: number;
}
function parseRefreshEntry(json: string): { userId: number; hash: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new UnauthorizedException('refresh payload malformed');
  }
  if (!obj || typeof obj !== 'object') {
    throw new UnauthorizedException('refresh payload malformed');
  }
  const rec = obj as Record<string, unknown>;
  const u = rec['userId'];
  const h = rec['hash'];
  if (typeof u !== 'number' || typeof h !== 'string') {
    throw new UnauthorizedException('refresh payload malformed');
  }
  return { userId: u, hash: h };
}
// --------------------------------------------

@Injectable()
export class SteamOpenIdService {
  private readonly logger = new Logger(SteamOpenIdService.name);
  private readonly realm: string;
  private readonly returnTo: string;
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;

  // Simple in-memory fallback for dev (used when no REDIS provider is bound)
  private readonly mem = new Map<string, string>();
  private get inMemoryRedis(): RedisLike {
    const store = this.mem;
    type Op = { kind: 'set' | 'del'; fn: () => void };
    const createPipeline = (): RedisPipeline => {
      const ops: Op[] = [];
      return {
        set(
          key: string,
          value: string,
          ...args: (string | number)[]
        ): RedisPipeline {
          // consume args to satisfy eslint no-unused-vars
          void args.length;
          ops.push({ kind: 'set', fn: () => store.set(key, value) });
          return this;
        },
        del(key: string): RedisPipeline {
          ops.push({ kind: 'del', fn: () => store.delete(key) });
          return this;
        },
        async exec(): Promise<PipelineResult[] | null> {
          await Promise.resolve();
          ops.forEach((o) => o.fn());
          return ops.map((o) => (o.kind === 'set' ? [null, 'OK'] : [null, 1]));
        },
      };
    };
    return {
      multi: createPipeline,
      async set(
        key: string,
        value: string,
        ...args: (string | number)[]
      ): Promise<'OK'> {
        // consume args to satisfy eslint no-unused-vars
        void args.length;
        await this.multi()
          .set(key, value, ...args)
          .exec();
        return 'OK';
      },
      async get(key: string): Promise<string | null> {
        await Promise.resolve();
        return store.get(key) ?? null;
      },
      async del(key: string): Promise<number> {
        await Promise.resolve();
        return store.delete(key) ? 1 : 0;
      },
    };
  }

  constructor(
    private readonly cfg: ConfigService,
    private readonly jwt: JwtService,
    private readonly usersRepo: UsersRepository,
    private readonly ownedRepo: OwnedGameRepository,
    private readonly cache: CacheAsideService,
    private readonly friendsService: FriendsService,
    @Optional() @Inject('REDIS') private readonly redis?: RedisLike,
  ) {
    this.realm = this.cfg.getOrThrow<string>('STEAM_REALM');
    this.returnTo = this.cfg.getOrThrow<string>('STEAM_RETURN_TO');
    this.accessSecret = this.cfg.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = this.cfg.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessTtlSec = parseInt(
      this.cfg.get<string>('JWT_EXPIRES_IN', '900') ?? '900',
      10,
    );
    this.refreshTtlSec = parseInt(
      this.cfg.get<string>('JWT_REFRESH_EXPIRES_IN', '259200') ?? '259200',
      10,
    );
  }

  // 안전 게터: 실제 Redis 없으면 메모리 대체
  private get r(): RedisLike {
    return this.redis ?? this.inMemoryRedis;
  }

  // 로그인 시작 URL 생성
  async buildRedirectUrl(): Promise<string> {
    // 테스트/개발 환경에서 설정이 없을 경우 기본값 사용
    const realm =
      this.cfg.get<string>('STEAM_REALM') ?? 'http://localhost:3000';
    const returnTo =
      this.cfg.get<string>('STEAM_RETURN_TO') ??
      `${realm.replace(/\/$/, '')}/api/v1/auth/steam/callback`;
    const r = new URL(realm);
    const t = new URL(returnTo);
    const sameOrigin = r.protocol === t.protocol && r.host === t.host;
    if (!sameOrigin) {
      const msg = `STEAM_REALM and STEAM_RETURN_TO must share the same origin. realm=${realm} return_to=${returnTo}`;
      this.logger.error(msg);
      throw new BadRequestException('Steam OpenID misconfiguration');
    }

    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');

    const replies: PipelineResult[] | null = await this.r
      .multi()
      .set(`oid:state:${state}`, '1', 'EX', 600, 'NX')
      .set(`oid:nonce:${nonce}`, '1', 'EX', 600, 'NX')
      .exec();
    if (!replies) throw new BadRequestException('redis transaction aborted');
    const ok1 = replies[0][1] === 'OK';
    const ok2 = replies[1][1] === 'OK';
    if (!ok1 || !ok2)
      throw new BadRequestException('failed to save state/nonce');

    // return_to에 state/nonce를 포함
    const rt = new URL(returnTo);
    rt.searchParams.set('state', state);
    rt.searchParams.set('nonce', nonce);

    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': rt.toString(),
      'openid.realm': realm,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    return `${OP}?${params.toString()}`;
  }

  private async ensureUser(
    steamId: string,
    patch: Partial<User> = {},
  ): Promise<User> {
    return this.usersRepo.upsertBySteamId(steamId, patch);
  }

  async finalizeLogin(query: Record<string, string>): Promise<AuthResult> {
    // OpenID 콜백 검증 + SteamID64 추출
    const { steamid64 } = await this.verifyCallback(query);
    const steamId64 = steamid64; // 변수명 통일

    // 프로필 보강(선택)
    let personaName: string | null = null;
    let avatar: string | null = null;

    const steamKey = this.cfg.get<string>('STEAM_API_KEY');
    if (steamKey) {
      try {
        const { data } = await axios.get<SteamSummaries>(
          'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/',
          {
            params: { key: steamKey, steamids: steamid64 }, // 외부 API에는 문자열로 전달
            timeout: 5000,
          },
        );

        const player = data?.response?.players?.[0];

        personaName =
          typeof player?.personaname === 'string' ? player.personaname : null;
        avatar =
          typeof player?.avatarfull === 'string' ? player.avatarfull : null;
      } catch {
        /* optional enrichment failed, ignore */
      }
    }

    // 유저 upsert (내부 User는 string 유지)
    const steamIdStr = String(steamId64);
    const user = await this.ensureUser(steamIdStr, { personaName, avatar });

    await this.cache.invalidateByIndex(profileIdx(user.id));

    if (steamKey) {
      try {
        const { games, owned } = await this.ownedRepo.fetchOwnedGamesAsRows(
          steamKey,
          user,
        );

        await this.ownedRepo.upsertGames(games);
        await this.ownedRepo.upsertOwnedMany(owned);
        await this.cache.invalidateByIndex(myGamesIdx(user.id));

        // 🔥 친구 목록 동기화 추가!
        await this.friendsService.syncFriendsFromSteam(user, steamKey);
      } catch (error) {
        console.error('게임/친구 동기화 실패:', errorSummary(error));
      }
    }

    // 토큰 발급
    const { token: accessToken } = await this.signAccessToken(user.id);
    const { token: refreshToken, jti } = await this.signRefreshToken(user.id);

    await this.storeRefreshToken(jti, user.id, refreshToken);

    return {
      user: {
        id: user.id,
        steamId: user.steamId,
        personaName: user.personaName,
        avatar: user.avatar,
      },
      accessToken,
      accessTokenExpiresIn: this.accessTtlSec,
      refreshToken,
      refreshTokenMaxAgeMs: this.refreshTtlSec * 1000,
      steamId64, // 콜백에서 사용
    };
  }

  async testLogin(steamId: string): Promise<TestLoginResult> {
    try {
      const steamIdStr = String(steamId);
      if (!/^\d{17}$/.test(steamIdStr)) {
        throw new BadRequestException('invalid steamId');
      }
      const user = await this.ensureUser(steamIdStr);

      // JWT_ACCESS_SECRET 값을 출력하여 확인
      console.log(
        'testLogin에서 사용되는 JWT_ACCESS_SECRET:',
        this.accessSecret,
      );

      // JWT 토큰 직접 생성 (signAccessToken, signRefreshToken 메서드 사용하지 않음)
      const accessPayload = { sub: user.id, typ: 'access' };
      const accessToken = await this.jwt.signAsync(accessPayload, {
        secret: this.accessSecret,
        expiresIn: 900, // 하드코딩된 값: 15분 (초 단위)
      });

      console.log(
        '생성된 Access Token 페이로드:',
        this.jwt.decode(accessToken),
      );

      const jti = randomBytes(16).toString('hex');
      const refreshPayload = { sub: user.id, jti, typ: 'refresh' as const };
      const refreshToken = await this.jwt.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: 259200, // 하드코딩된 값: 3일 (초 단위)
      });

      // 저장용 해시 생성
      const hash = createHash('sha256').update(refreshToken).digest('hex');
      await this.r.set(
        `rt:${jti}`,
        JSON.stringify({ userId: user.id, hash }),
        'EX',
        259200,
        'NX',
      );

      return {
        user: {
          id: user.id,
          steamId: user.steamId,
          personaName: user.personaName,
          avatar: user.avatar,
        },
        accessToken,
        accessTokenExpiresIn: 900,
        refreshToken,
        refreshTokenMaxAgeMs: 259200 * 1000,
      };
    } catch (error) {
      console.error('Error in testLogin:', errorSummary(error));
      throw error;
    }
  }
  protected async signAccessToken(userId: number): Promise<{ token: string }> {
    const payload = { sub: userId, typ: 'access' };
    const token = await this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessTtlSec,
    });
    return { token };
  }

  protected async signRefreshToken(
    userId: number,
  ): Promise<{ token: string; jti: string }> {
    const jti = randomBytes(16).toString('hex');
    const payload = { sub: userId, jti, typ: 'refresh' };
    const token = await this.jwt.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshTtlSec,
    });
    return { token, jti };
  }

  protected async storeRefreshToken(
    jti: string,
    userId: number,
    token: string,
  ) {
    const hash = createHash('sha256').update(token).digest('hex');
    await this.r.set(
      `rt:${jti}`,
      JSON.stringify({ userId, hash }),
      'EX',
      this.refreshTtlSec,
      'NX',
    );
  }

  async rotateRefreshToken(oldToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    refreshTokenMaxAgeMs: number;
  }> {
    // refresh JWT 검증
    console.log(
      '[rotateRefreshToken] called with',
      oldToken.slice(0, 30),
      '...',
    );
    const decoded = await this.jwt
      .verifyAsync<RefreshPayload>(oldToken, {
        secret: this.refreshSecret,
      })
      .catch(() => {
        throw new UnauthorizedException('invalid refresh token');
      });

    const userId = decoded.sub;
    const jti = decoded.jti;
    if (!userId || !jti)
      throw new UnauthorizedException('malformed refresh token');

    // redis에 저장된 해시와 일치하는지 확인
    const entry = await this.r.get(`rt:${jti}`);
    if (typeof entry !== 'string') {
      throw new UnauthorizedException('refresh revoked/expired');
    }
    const parsed = parseRefreshEntry(entry); // { userId: number; hash: string }
    const storedUserId = parsed.userId;
    const hash = parsed.hash;

    const givenHash = createHash('sha256').update(oldToken).digest('hex');
    if (hash !== givenHash) throw new UnauthorizedException('refresh mismatch');
    if (storedUserId !== userId)
      throw new UnauthorizedException('refresh subject mismatch');

    //회전: 기존 키 삭제 -> 새 토큰 발급 -> 새 키 저장
    await this.r.del(`rt:${jti}`);

    const { token: accessToken } = await this.signAccessToken(userId);
    const { token: refreshToken, jti: newJti } =
      await this.signRefreshToken(userId);
    await this.storeRefreshToken(newJti, userId, refreshToken);

    return {
      accessToken,
      refreshToken,
      refreshTokenMaxAgeMs: this.refreshTtlSec * 1000,
    };
  }

  // 콜백 검증 + SteamID64 추출
  async verifyCallback(
    query: Record<string, string>,
  ): Promise<{ steamid64: string; state?: string }> {
    try {
      const mode = query['openid.mode'];
      if (mode !== 'id_res')
        throw new BadRequestException('invalid openid mode');

      // op_endpoint 고정
      if (query['openid.op_endpoint'] && query['openid.op_endpoint'] !== OP) {
        throw new BadRequestException('unexpected op_endpoint');
      }

      // return_to 체크(우리 콜백 URL과 완전 동일해야함)
      const returnTo = query['openid.return_to'];
      if (!returnTo) throw new BadRequestException('missing return_to');

      const rt = new URL(returnTo);
      const base = new URL(this.returnTo);
      const sameBase =
        rt.origin === base.origin && rt.pathname === base.pathname;
      if (!sameBase) throw new BadRequestException('return_to mismatch');
      // state, nonce 체크
      const state = rt.searchParams.get('state') ?? query['state'];
      const nonce = rt.searchParams.get('nonce') ?? query['nonce'];
      if (!state) throw new BadRequestException('state missing');

      const opNonce = query['openid.response_nonce'];
      if (!opNonce) throw new BadRequestException('response_nonce missing');

      const multi = this.r.multi().del(`oid:state:${state}`);
      if (nonce) multi.del(`oid:nonce:${nonce}`);
      multi.set(`oid:opnonce:${opNonce}`, '1', 'EX', 600, 'NX');
      const results: PipelineResult[] | null = await multi.exec();
      if (!results) throw new BadRequestException('transaction aborted');

      let i = 0;

      const next = (): PipelineResult => {
        const item = results[i++];
        if (!item) throw new BadRequestException('transaction aborted');
        return item;
      };

      //DEL state
      const [err1, v1] = next();
      const delStateOk = err1 === null && v1 === 1;
      if (!delStateOk) {
        throw new BadRequestException('unknown or reused state');
      }

      if (nonce) {
        const [err2, v2] = next();
        const delOurNonceOk = err2 === null && v2 === 1;
        if (!delOurNonceOk) {
          throw new BadRequestException('unknown or reused nonce');
        }
      }

      const [err3, v3] = next();
      const setOpNonceOk = err3 === null && v3 === 'OK';
      if (!setOpNonceOk) {
        throw new BadRequestException('replay detected (response_nonce)');
      }

      // OpenID 서명 검증 요청 본문 만들기
      const body = new URLSearchParams();
      for (const k of Object.keys(query)) {
        if (k.startsWith('openid.') && k !== 'openid.mode') {
          const v = query[k];
          if (typeof v === 'string') body.append(k, v);
        }
      }

      body.set('openid.mode', 'check_authentication');

      const { data } = await axios.post<string>(OP, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 7000,
      });

      const isValid =
        typeof data === 'string' && data.includes('is_valid:true');
      if (!isValid) throw new BadRequestException('invalid openid signature');

      // steamid64 파싱
      const claimed = query['openid.claimed_id'] ?? '';
      const match = claimed.match(/\/id\/(\d{17})$|\/openid\/id\/(\d{17})$/);
      const steamid64 = match?.[1] ?? match?.[2];
      if (!steamid64) throw new BadRequestException('steamid parse failed');

      return { steamid64, state: state || undefined };
    } catch (e: unknown) {
      throw new BadRequestException(
        `OpenID verification failed: ${errorSummary(e)}`,
      );
    }
  }
}
