import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type Redis from 'ioredis';
import { REDIS } from '../infra/redis/redis.constants';
import { randomBytes, createHash } from 'crypto';
import { errorSummary } from 'src/common/error.util';
import {
  JsonWebTokenError,
  JwtService,
  NotBeforeError,
  TokenExpiredError,
} from '@nestjs/jwt';
import { UsersRepository } from 'src/domain/users/users.repository';
import { User } from 'src/domain/users/user.entity';
import { UnauthorizedException } from '@nestjs/common';
import { CacheAsideService } from 'src/common/cache/cache-aside.service';
import { myGamesIdx, profileIdx } from 'src/common/cache/keys';
import { OwnedGameRepository } from 'src/domain/games/owned-game.repository';

const OP = 'https://steamcommunity.com/openid/login';

type PipelineResult = [err: Error | null, res: 'OK' | number | null];

function parseRefreshEntry(json: string): { userId: number; hash: string } {
  const obj: unknown = JSON.parse(json);
  if (!obj || typeof obj !== 'object') {
    throw new UnauthorizedException('refresh payload malformed');
  }
  const u = (obj as Record<string, unknown>)['userId'];
  const h = (obj as Record<string, unknown>)['hash'];

  if (typeof u !== 'number' || typeof h !== 'string') {
    throw new UnauthorizedException('refresh payload malformed');
  }
  return { userId: u, hash: h };
}

interface SteamSummaries {
  response: { players: Array<{ personaname?: string; avatarfull?: string }> };
}

interface RefreshPayload {
  sub: number;
  jti?: string;
  typ?: 'refresh';
}

@Injectable()
export class SteamOpenIdService {
  private readonly realm: string;
  private readonly returnTo: string;
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;

  constructor(
    private readonly cfg: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly usersRepo: UsersRepository,
    private readonly ownedRepo: OwnedGameRepository,
    private readonly cache: CacheAsideService,
  ) {
    this.realm = this.cfg.getOrThrow<string>('STEAM_REALM');
    this.returnTo = this.cfg.getOrThrow<string>('STEAM_RETURN_TO');
    this.accessSecret = this.cfg.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = this.cfg.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessTtlSec = parseInt(
      this.cfg.get<string>('JWT_EXPIRES_IN', '90000') ?? '90000',
      10,
    );
    this.refreshTtlSec = parseInt(
      this.cfg.get<string>('JWT_REFRESH_EXPIRES_IN', '259200') ?? '259200',
      10,
    );
  }

  // 로그인 시작 URL 생성
  async buildRedirectUrl(): Promise<string> {
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');

    // 10분 TTL
    const replies = (await this.redis
      .multi()
      .set(`oid:state:${state}`, '1', 'EX', 600, 'NX')
      .set(`oid:nonce:${nonce}`, '1', 'EX', 600, 'NX')
      .exec()) as PipelineResult[] | null;

    if (!replies) throw new BadRequestException('redis transaction aborted');

    const ok1 = replies[0][1] === 'OK';
    const ok2 = replies[1][1] === 'OK';

    if (!ok1 || !ok2)
      throw new BadRequestException('failed to save state/nonce');

    //return_to에 state/nonce를 심어 보냄(콜백에서 그대로 돌아옴)
    const rt = new URL(this.returnTo);
    rt.searchParams.set('state', state);
    rt.searchParams.set('nonce', nonce);

    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': rt.toString(),
      'openid.realm': this.realm,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    return `${OP}?${params.toString()}`;
  }

  private async ensureUser(
    steamid64: string,
    patch?: { personaName?: string | null; avatar?: string | null },
  ): Promise<User> {
    return this.usersRepo.upsertBySteamId(steamid64, patch);
  }

  async finalizeLogin(query: Record<string, string>): Promise<{
    user: Pick<User, 'id' | 'steamId' | 'personaName' | 'avatar'>;
  }> {
    // OpenID 콜백 검증 + SteamID64 추출
    const { steamid64 } = await this.verifyCallback(query);

    let personaName: string | null = null;
    let avatar: string | null = null;

    const steamKey = this.cfg.get<string>('STEAM_API_KEY');
    if (steamKey) {
      try {
        const { data } = await axios.get<SteamSummaries>(
          'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/',
          {
            params: { key: steamKey, steamids: steamid64 },
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

    // 유저 upsert (프로필 함께 패치)
    const user = await this.ensureUser(steamid64, { personaName, avatar });

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
      } catch {
        /*..*/
      }
    }

    return {
      user: {
        id: user.id,
        steamId: user.steamId,
        personaName: user.personaName,
        avatar: user.avatar,
      },
    };
  }

  async issueTokens(
    userId: number,
    opts: { access?: boolean; refresh?: boolean },
  ): Promise<{
    accessToken?: string;
    accessExpSec?: number;
    refreshToken?: string;
    refreshMaxAgeMs?: number;
  }> {
    const out: {
      accessToken?: string;
      accessExpSec?: number;
      refreshToken?: string;
      refreshMaxAgeMs?: number;
    } = {};

    if (opts.access) {
      const { token } = await this.signAccessToken(userId);
      out.accessToken = token;
      out.accessExpSec = this.accessTtlSec * 1000;
    }

    if (opts.refresh) {
      const { token, jti } = await this.signRefreshToken(userId);
      await this.storeRefreshToken(jti, userId, token);
      out.refreshToken = token;
      out.refreshMaxAgeMs = this.refreshTtlSec * 1000;
    }
    return out;
  }

  async verifyRefreshAndGetUser(refreshToken: string): Promise<number> {
    let payload: RefreshPayload;
    try {
      payload = this.jwt.verify<RefreshPayload>(refreshToken, {
        secret: this.refreshSecret,
        algorithms: ['HS256'],
        ignoreExpiration: false,
        clockTolerance: 5,
      });
    } catch (e) {
      if (e instanceof TokenExpiredError)
        throw new UnauthorizedException('REFRESH_EXPIRED');
      if (e instanceof NotBeforeError)
        throw new UnauthorizedException('REFRESH_NOT_ACTIVE');
      if (e instanceof JsonWebTokenError)
        throw new UnauthorizedException('REFRESH_INVALID');
    }

    const jti = payload!.jti;
    const userIdFromJwt = Number(payload!.sub);

    if (!jti || !userIdFromJwt)
      throw new UnauthorizedException('REFRESH_MALFORMED');

    const stored = await this.redis.get(`rt:${jti}`);
    if (!stored) throw new UnauthorizedException('REFERESH_REVOKED_OR_MISSING');

    const { userId: userIdFromStore, hash } = parseRefreshEntry(stored);

    const givenHash = createHash('sha256').update(refreshToken).digest('hex');

    if (userIdFromStore !== userIdFromJwt)
      throw new UnauthorizedException('REFRESH_SUBJECT_MISMATCH');
    if (hash !== givenHash)
      throw new UnauthorizedException('REFERESH_MISMATCH');
    return userIdFromStore;
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    let payload: RefreshPayload | null = null;
    try {
      payload = this.jwt.verify<RefreshPayload>(refreshToken, {
        secret: this.refreshSecret,
        algorithms: ['HS256'],
        ignoreExpiration: false,
        clockTolerance: 5,
      });
    } catch {
      return;
    }

    const jti = payload.jti;
    const userIdFromJwt = payload.sub;
    if (!jti || !userIdFromJwt) return;

    const entry = await this.redis.get(`rt:${jti}`);
    if (!entry) return;

    const { userId: storedUserId, hash } = parseRefreshEntry(entry);
    if (storedUserId !== userIdFromJwt) return;

    const givenHash = createHash('sha256').update(refreshToken).digest('hex');
    if (hash !== givenHash) return;

    await this.redis.del(`rt:${jti}`);
  }

  async testLogin(steamId: string) {
    try {
      const user = await this.ensureUser(steamId);

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
      const refreshPayload = { sub: user.id, jti, typ: 'refresh' };
      const refreshToken = await this.jwt.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: 259200, // 하드코딩된 값: 3일 (초 단위)
      });

      // Redis에 토큰 저장 (storeRefreshToken 메서드 사용하지 않음)
      const hash = createHash('sha256').update(refreshToken).digest('hex');
      await this.redis.set(
        `rt:${jti}`,
        JSON.stringify({ userId: user.id, hash }),
        'EX',
        259200, // 하드코딩된 값: 3일 (초 단위)
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
      console.error('Error in testLogin:', error);
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
    await this.redis.set(
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
    const entry = await this.redis.get(`rt:${jti}`);
    if (!entry) throw new UnauthorizedException('refresh revoked/expired');

    const { userId: storedUserId, hash } = parseRefreshEntry(entry);
    const givenHash = createHash('sha256').update(oldToken).digest('hex');
    if (hash !== givenHash) throw new UnauthorizedException('refresh mismatch');
    if (storedUserId !== userId)
      throw new UnauthorizedException('refresh subject mismatch');

    //회전: 기존 키 삭제 -> 새 토큰 발급 -> 새 키 저장
    await this.redis.del(`rt:${jti}`);

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

      const multi = this.redis.multi().del(`oid:state:${state}`);
      if (nonce) multi.del(`oid:nonce:${nonce}`);
      multi.set(`oid:opnonce:${opNonce}`, '1', 'EX', 600, 'NX');

      const results = (await multi.exec()) as PipelineResult[] | null;
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

      for (const [k, v] of Object.entries(query)) {
        if (k.startsWith('openid.') && k !== 'openid.mode') {
          body.append(k, v);
        }
      }

      //마지막에 단 한 번만 check_authentication 지정
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
