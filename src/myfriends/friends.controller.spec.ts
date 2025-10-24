import { Test, TestingModule } from '@nestjs/testing';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { GetFriendsDto, FriendListResponse } from './get-friends.dto';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { User } from '../domain/users/user.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

describe('FriendsController', () => {
  let controller: FriendsController;
  let getFriendsMock: jest.Mock;

  beforeEach(async () => {
    // ✅ FriendListResponse 구조에 맞게 수정
    getFriendsMock = jest.fn().mockResolvedValue({
      summary: {
        total: 1,
        stale: false,
      },
      items: [
        {
          steamid: '76561198000000002',
          persona_name: 'TestUser',
          avatar: 'https://example.com/avatar.jpg',
          relationship: 'friend',
          links: {
            profile: '/api/v1/friends/76561198000000002',
            common_games: '/api/v1/friends/76561198000000002/common-games',
            compare_achievements:
              '/api/v1/friends/76561198000000002/games/{gameId}/achievements/compare',
          },
        },
      ],
      paging: {
        page: 1,
        size: 30,
        total: 1,
      },
      links: {
        self: '/api/v1/friends?page=1&size=30',
        refresh: '/api/v1/friends?force=true',
      },
      trace_id: 'test-trace-id',
    });

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            ttl: 60,
            limit: 10,
          },
        ]),
      ],
      controllers: [FriendsController],
      providers: [
        {
          provide: FriendsService,
          useValue: {
            getFriends: getFriendsMock,
          },
        },
        {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<FriendsController>(FriendsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return friend list', async () => {
    const userId = '1';

    // ✅ limit → size로 변경
    const query: GetFriendsDto = {
      page: 1,
      size: 30,
      sort: 'name',
    };

    // ✅ 반환 타입 수정
    const result: FriendListResponse = await controller.getFriends(
      userId,
      query,
    );

    expect(getFriendsMock).toHaveBeenCalledWith(1, query);
    expect(result.items).toHaveLength(1);
    expect(result.summary.total).toBe(1);
    expect(result.paging.page).toBe(1);
    expect(result.paging.size).toBe(30);
  });
});
