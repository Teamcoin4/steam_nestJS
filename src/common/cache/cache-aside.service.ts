import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Redis } from 'ioredis';

type GetOrLoadOptions = {
  // 개별 호출 TTL(초) - 미지정 시 CacheModule 기본 TTL 사용
  ttlSec?: number;
  // 무효화용 인덱스 세트 이름. 지정 시 키를 세트에 등록
  index?: string | string[];
  // 스탬피드 방지 락 유지 시간(ms)
  lockMs?: number;
};

type RedisStoreLike = { getClient: () => Redis };
const hasGetClient = (x: unknown): x is RedisStoreLike => {
  const o = x as { getClient?: unknown } | null;
  return !!o && typeof o.getClient === 'function';
};

@Injectable()
export class CacheAsideService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private get redis(): Redis | null {
    const storeUnknown = Reflect.get(this.cache as object, 'store') as unknown;
    return hasGetClient(storeUnknown) ? storeUnknown.getClient() : null;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, ms));
  }

  private asArray(v?: string | string[]): string[] {
    return Array.isArray(v) ? v : v ? [v] : [];
  }

  private async addToIndices(
    indices: string[],
    key: string,
    client: Redis | null,
  ): Promise<void> {
    if (!client || indices.length === 0) return;
    await Promise.all(indices.map((idx) => client.sadd(idx, key)));
  }

  // Cache-Aside(+single-flight)
  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    opts?: GetOrLoadOptions,
  ): Promise<T> {
    const cached = await this.cache.get<T>(key);
    if (cached !== undefined && cached !== null) return cached;

    const lockKey = `lock:${key}`;
    const lockMs = opts?.lockMs ?? 5000;

    const client = this.redis;

    // SET NX PX로 락 시도
    const locked = client
      ? await client.set(lockKey, '1', 'PX', lockMs, 'NX')
      : 'OK';
    if (locked) {
      try {
        const data = await loader();

        if (opts?.ttlSec !== undefined)
          await this.cache.set(key, data as any, opts.ttlSec);
        else await this.cache.set(key, data as any);

        // 인덱스 등록
        const indices = this.asArray(opts?.index);
        await this.addToIndices(indices, key, client);

        return data;
      } finally {
        if (client) await client.del(lockKey);
      }
    }

    // 누군가 로딩 중 -> 짧게 대기 후 재조회
    await this.sleep(80);
    const retry = await this.cache.get<T>(key);
    if (retry !== undefined && retry !== null) return retry;

    // 혹시 락이 끊겼는데 아직 미적재라면 안전하게 직접 로드
    const data = await loader();
    if (opts?.ttlSec !== undefined)
      await this.cache.set(key, data as any, opts.ttlSec);
    else await this.cache.set(key, data as any);

    const indices = this.asArray(opts?.index);
    await this.addToIndices(indices, key, client);
    return data;
  }

  get<T>(key: string): Promise<T | undefined> {
    return this.cache.get<T>(key);
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this.cache.set(key, value as any, ttlMs);
  }

  async del(key: string): Promise<void> {
    await this.cache.del(key);
  }

  async wrap<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined && hit !== null) return hit;
    const val = await factory();
    await this.set<T>(key, val, ttlMs);
    return val;
  }

  // 인덱스에 등록된 모든 키 무효화
  async invalidateByIndex(index: string | string[]): Promise<void> {
    const indices = this.asArray(index);
    if (indices.length === 0) return;
    const client = this.redis;
    if (!client) {
      // Redis 미사용이면 인덱스 기반 무효화는 건너뜀
      return;
    }
    for (const idx of indices) {
      try {
        const members = await client.smembers(idx);
        if (members.length > 0) {
          // 캐시 키 삭제
          await client.del(...members);
        }
        // 인덱스 세트 삭제
        await client.del(idx);
      } catch {
        // 인덱스 하나 실패해도 전체 실패로 보지 않음
      }
    }
  }
}
