import { Test, TestingModule } from '@nestjs/testing';
import { FriendsService } from './friends.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Friend } from '../domain/friends/friends.entity';
import { User } from '../domain/users/user.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';
import { GetFriendsDto } from './get-friends.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { SteamService } from '../integrations/steam/steam.service';

interface MockRedisCache {
  keys: jest.Mock;
  del: jest.Mock;
}

describe('FriendsService', () => {
  let service: FriendsService;
  let friendRepository: jest.Mocked<Partial<Repository<Friend>>>;
  let userRepository: jest.Mocked<Partial<Repository<User>>>;
  let ownedGameRepository: jest.Mocked<Partial<Repository<OwnedGame>>>;
  let cacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    stores: MockRedisCache;
  };
  let steamService: jest.Mocked<Partial<SteamService>>;

  beforeEach(async () => {
    const mockFriendQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
    } as unknown as SelectQueryBuilder<Friend>;

    friendRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockFriendQueryBuilder),
    } as jest.Mocked<Partial<Repository<Friend>>>;

    userRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as jest.Mocked<Partial<Repository<User>>>;

    ownedGameRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    } as jest.Mocked<Partial<Repository<OwnedGame>>>;

    steamService = {
      getOwnedGames: jest.fn().mockResolvedValue({
        game_count: 0,
        games: [],
      }),
      buildAppHeaderUrl: jest.fn(
        (appid: number) =>
          `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
      ),
    } as jest.Mocked<Partial<SteamService>>;

    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      stores: {
        keys: jest.fn().mockResolvedValue([]),
        del: jest.fn().mockResolvedValue(undefined),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        {
          provide: getRepositoryToken(Friend),
          useValue: friendRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(OwnedGame),
          useValue: ownedGameRepository,
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
        {
          provide: SteamService,
          useValue: steamService,
        },
      ],
    }).compile();

    service = module.get<FriendsService>(FriendsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return empty friend list', async () => {
    const dto = new GetFriendsDto();
    dto.page = 1;
    dto.size = 10;

    (friendRepository.createQueryBuilder as jest.Mock).mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
    } as unknown as SelectQueryBuilder<Friend>);

    const result = await service.getFriends(1, dto);

    expect(result.items).toEqual([]);
    expect(result.paging).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
  });
});
