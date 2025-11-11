import '../tracing';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { LoggerService } from './common/logger/logger.service';

async function bootstrap(): Promise<void> {
  // 🧩 1️⃣ 로깅 버퍼 활성화
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 🧩 2️⃣ 커스텀 로거 주입
  const logger = app.get(LoggerService);
  app.useLogger(logger);

  // 🧩 Nest Logger의 레벨 설정 (debug 활성화)
  const nestLogger = new Logger('Bootstrap');
  nestLogger.debug('Logger initialized with debug level');

  // 🧩 4️⃣ 글로벌 prefix 설정
  app.setGlobalPrefix('api/v1');

  // ✅ any 없이, 여러 오리진 허용
  const allowList = [
    'http://localhost:3000',
    'http://localhost:3001',
    process.env.NEXT_PUBLIC_SITE_URL, // 배포 도메인 있으면
  ].filter((v): v is string => Boolean(v));

  app.enableCors({
    origin: allowList, // ← 함수 말고 배열 사용
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Authorization'],
  });

  app.use(cookieParser(process.env.COOKIE_SECRET));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`🚀 Server running on http://localhost:${port}/api/v1`);

  logger.log(
    `Application is running on: http://localhost:${port}`,
    'Bootstrap',
  );
  logger.log(
    `Metrics available at: http://localhost:${port}/metrics`,
    'Bootstrap',
  );
}
bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
