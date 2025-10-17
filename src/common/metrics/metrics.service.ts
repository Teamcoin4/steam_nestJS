import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric('steam_app_http_requests_total')
    public readonly httpRequestsTotal: Counter<string>,

    @InjectMetric('steam_app_http_request_duration_seconds')
    public readonly httpRequestDuration: Histogram<string>,

    @InjectMetric('steam_app_active_connections')
    public readonly activeConnections: Gauge<string>,

    @InjectMetric('steam_app_errors_total')
    public readonly errorsTotal: Counter<string>,
  ) {}

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

  incrementActiveConnections() {
    this.activeConnections.inc();
  }

  decrementActiveConnections() {
    this.activeConnections.dec();
  }
}
