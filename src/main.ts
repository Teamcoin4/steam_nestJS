import '../tracing';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { LoggerService } from './common/logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(LoggerService);
  app.useLogger(logger);

  // ✅ 글로벌 Prefix 추가
  app.setGlobalPrefix('api/v1');

  // ✅ CORS 설정 강화 (쿠키 포함 + 프론트 3001 허용)
  app.enableCors({
    origin: 'http://localhost:3001', // 프론트엔드 주소
    credentials: true, // 쿠키 전송 허용
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], // 허용 메서드 명시
    allowedHeaders: ['Content-Type', 'Authorization'], // 명시적으로 허용
    exposedHeaders: ['Authorization'], // 클라이언트에서 접근 허용
  });

  // ✅ 쿠키 파서 (서명키 optional)
  app.use(cookieParser(process.env.COOKIE_SECRET));

  // ✅ 유효성 파이프 전역 적용
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

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
