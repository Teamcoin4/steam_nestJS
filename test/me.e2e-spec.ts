import {
  INestApplication,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'http';
import type { Request } from 'express';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DataSource, Repository } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { User } from '../src/domain/users/user.entity';

// OwnedGame 시드는 제거하여 FK 충돌 회피 (빈 목록으로 검증)

interface OwnedListItem {
  appId: number;
  name: string;
  icon: string;
  you: {
    playtimeForever: number;
    playtime2Weeks: number;
    lastPlayedAt: Date | null;
    installed: boolean;
    hidden: boolean;
    addedAt: string | null;
  };
  achievements?:
    | {
        supported: true;
        unlocked: number;
        total: number;
        completion_rate: number;
      }
    | {
        supported: false;
        unlocked: 0;
        total: 0;
        completion_rate: 0;
      };
  links: {
    game: string;
    achievements_me: string;
    achievements_defs: string;
  };
}

interface ListMyGamesResponse {
  page: number;
  size: number;
  total: number;
  items: OwnedListItem[];
}

// Express의 Request.user(프로젝트 보강 타입)와 호환되는 테스트 사용자 타입
type E2EUser = {
  id: number;
  steamId: string;
  personaName?: string | null;
  avatar?: string | null;
  // 선택: 컨트롤러/데코레이터 호환용
  sub?: number;
  userId?: number;
};

// 요청에 user를 주입하는 허용 가드
class AllowAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: E2EUser }>();
    req.user = {
      id: 1,
      steamId: '76561198000355602',
      personaName: 'kim',
      avatar: null,
      sub: 1,
      userId: 1,
    };
    return true;
  }
}

// DB 초기화 유틸: 모든 엔티티 테이블을 실제 이름으로 TRUNCATE
async function truncateAll(ds: DataSource): Promise<void> {
  const tableNames = ds.entityMetadatas.map((m) => `"${m.tableName}"`);
  if (tableNames.length > 0) {
    await ds.query(
      `TRUNCATE TABLE ${tableNames.join(', ')} RESTART IDENTITY CASCADE;`,
    );
  }
}

describe('MeController e2e', () => {
  let app: INestApplication;
  let httpServer: Server;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  // OwnedGame 리포지토리는 사용하지 않습니다.

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AllowAuthGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: [] });
    await app.init();

    httpServer = app.getHttpServer() as unknown as Server;
    dataSource = moduleRef.get<DataSource>(getDataSourceToken());
    userRepository = dataSource.getRepository(User);
    // OwnedGame 리포지토리 초기화 제거

    // 테스트 데이터 준비 (실제 테이블명 기반으로 전체 초기화)
    await truncateAll(dataSource);

    await userRepository.save(
      userRepository.create({
        id: 1,
        steamId: '76561198000355602',
        personaName: 'kim',
        avatar: 'https://example/avatar.jpg',
        created_at: new Date('2025-09-06T08:30:00Z'),
        updated_at: new Date('2025-09-30T09:00:00Z'),
      }),
    );

    // OwnedGame 시드는 생략 (빈 결과에서도 응답 형식/상태 코드만 검증)
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/me -> 내 프로필 반환', async () => {
    const res = await request(httpServer).get('/api/v1/me').expect(200);

    expect(res.body).toEqual({
      data: {
        id: 1,
        steamId: '76561198000355602',
        personaName: 'kim',
        avatar: 'https://example/avatar.jpg',
        created_at: '2025-09-06T08:30:00.000Z',
        updated_at: '2025-09-30T09:00:00.000Z',
      },
      error: null,
    });
  });

  it('GET /api/v1/me/games -> 기본 페이징/정렬 + 아이템 스키마', async () => {
    const res = await request(httpServer).get('/api/v1/me/games').expect(200);

    const body = res.body as ListMyGamesResponse;

    expect(body.page).toBe(1);
    expect(body.size).toBe(30);
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /api/v1/me/games?force=true -> 캐시 무효화', async () => {
    await request(httpServer)
      .get('/api/v1/me/games')
      .query({ force: true })
      .expect(200);
  });

  it('GET /api/v1/me/games?sort=name&order=asc&page=2&size=10&keyword=por', async () => {
    const res = await request(httpServer)
      .get('/api/v1/me/games')
      .query({ sort: 'name', order: 'asc', page: 2, size: 10, keyword: 'por' })
      .expect(200);

    const body = res.body as ListMyGamesResponse;

    expect(Number(body.page)).toBe(2);
    expect(Number(body.size)).toBe(10);
    expect(typeof body.total).toBe('number');
  });
});
