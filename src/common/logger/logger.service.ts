import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import type { TransformableInfo } from 'logform';
import LokiTransport from 'winston-loki';
import { monitoringConfig } from '../../config/monitoring.config';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: winston.Logger;

  constructor() {
    const consoleFormat = winston.format.printf((info: TransformableInfo) => {
      const {
        timestamp = '',
        level = '',
        message = '',
        context,
        ...meta
      } = info;

      const ctx = typeof context === 'string' ? context : 'Application';
      const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';

      return `${String(timestamp)} [${String(ctx)}] ${String(level)}: ${String(message)} ${String(metaStr)}`;
    });

    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          consoleFormat,
        ),
      }),
    ];

    if (process.env.NODE_ENV !== 'test') {
      transports.push(
        new LokiTransport({
          host: monitoringConfig.loki.host,
          labels: monitoringConfig.loki.labels,
          json: true,
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
        winston.format.json(), // ✅ Loki가 필요한 JSON 형식으로 변환
      ),
      transports,
    });
  }

  log(message: string, context?: string) {
    this.logger.info(message, {
      context: context ?? 'Application',
      app: 'steam-nestjs',
    });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, {
      trace,
      context: context ?? 'Application',
      app: 'steam-nestjs',
    });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, {
      context: context ?? 'Application',
      app: 'steam-nestjs',
    });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, {
      context: context ?? 'Application',
      app: 'steam-nestjs',
    });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, {
      context: context ?? 'Application',
      app: 'steam-nestjs',
    });
  }

  logWithMetadata(
    level: string,
    message: string,
    metadata: Record<string, any>,
  ) {
    this.logger.log(level, message, { ...metadata, app: 'steam-nestjs' });
  }
}
