import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, Gauge } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry: Registry;

  // HTTP 요청 카운터
  public readonly httpRequestsTotal: Counter;

  // HTTP 요청 지속 시간
  public readonly httpRequestDuration: Histogram;

  // 활성 연결 수
  public readonly activeConnections: Gauge;

  // 에러 카운터
  public readonly errorsTotal: Counter;

  // Steam API 호출 카운터
  public readonly steamApiCalls: Counter;

  // Cache 히트/미스
  public readonly cacheHits: Counter;
  public readonly cacheMisses: Counter;

  constructor() {
    this.registry = new Registry();

    // HTTP 요청 총 개수
    this.httpRequestsTotal = new Counter({
      name: 'steam_app_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    // HTTP 요청 지속 시간
    this.httpRequestDuration = new Histogram({
      name: 'steam_app_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    // 활성 연결 수
    this.activeConnections = new Gauge({
      name: 'steam_app_active_connections',
      help: 'Number of active connections',
      registers: [this.registry],
    });

    // 에러 총 개수
    this.errorsTotal = new Counter({
      name: 'steam_app_errors_total',
      help: 'Total number of errors',
      labelNames: ['type', 'route'],
      registers: [this.registry],
    });

    // Steam API 호출
    this.steamApiCalls = new Counter({
      name: 'steam_app_steam_api_calls_total',
      help: 'Total number of Steam API calls',
      labelNames: ['endpoint', 'status'],
      registers: [this.registry],
    });

    // Cache 메트릭
    this.cacheHits = new Counter({
      name: 'steam_app_cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_name'],
      registers: [this.registry],
    });

    this.cacheMisses = new Counter({
      name: 'steam_app_cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_name'],
      registers: [this.registry],
    });
  }

  getRegistry(): Registry {
    return this.registry;
  }

  // 헬퍼 메서드들
  incrementHttpRequests(method: string, route: string, statusCode: number) {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode });
  }

  observeHttpDuration(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
  ) {
    this.httpRequestDuration.observe(
      { method, route, status_code: statusCode },
      duration,
    );
  }

  incrementErrors(type: string, route: string) {
    this.errorsTotal.inc({ type, route });
  }

  incrementSteamApiCall(endpoint: string, status: string) {
    this.steamApiCalls.inc({ endpoint, status });
  }

  incrementCacheHit(cacheName: string) {
    this.cacheHits.inc({ cache_name: cacheName });
  }

  incrementCacheMiss(cacheName: string) {
    this.cacheMisses.inc({ cache_name: cacheName });
  }

  incrementActiveConnections() {
    this.activeConnections.inc();
  }

  decrementActiveConnections() {
    this.activeConnections.dec();
  }
}
