import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';
import { monitoringConfig } from '../../config/monitoring.config';

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: winston.Logger;

  constructor() {
    const transports: winston.transport[] = [
      // Console transport
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.printf((info) => {
            const { timestamp, level, message, ...meta } = info;
            const context = meta.context as string | undefined;
            delete meta.context; // context를 meta에서 제거
            const ctx = context ?? 'Application';
            const metaStr = Object.keys(meta).length
              ? JSON.stringify(meta)
              : '';
            return `${String(timestamp)} [${ctx}] ${String(level)}: ${String(message)} ${metaStr}`;
          }),
        ),
      }),
    ];

    // Loki transport 추가 (프로덕션 환경)
    if (process.env.NODE_ENV !== 'test') {
      transports.push(
        new LokiTransport({
          host: monitoringConfig.loki.host,
          labels: monitoringConfig.loki.labels,
          json: true,
          format: winston.format.json(),
          replaceTimestamp: true,
          onConnectionError: (err) =>
            console.error('Loki connection error:', err),
        }),
      );
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      transports,
    });
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }

  // 커스텀 로그 메서드
  logWithMetadata(
    level: string,
    message: string,
    metadata: Record<string, any>,
  ) {
    this.logger.log(level, message, metadata);
  }
}
