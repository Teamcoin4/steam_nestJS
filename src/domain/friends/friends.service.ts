// src/myfriends/friends.service.ts
import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import type { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Friend, FriendStatus } from './friends.entity';
import { User } from '../users/user.entity';
import { OwnedGame } from '../games/owned-game.entity';
import { v4 as uuidv4 } from 'uuid';
import { In } from 'typeorm';
import axios from 'axios';
import {
  GetFriendsDto,
  FriendListResponse,
  FriendItem,
  FriendStats,
  RedisCache,
} from '../../myfriends/get-friends.dto';
import {
  GetCommonGamesDto,
  CommonGamesResponse,
  CommonGame,
} from '../../myfriends/get-common-games.dto';
import {
  GetAchievementCompareDto,
  AchievementCompareResponse,
  ComparedAchievementDetail,
} from '../../myfriends/get-achievement-compare.dto';
import { SteamService } from '../../integrations/steam/steam.service';

interface SteamFriend {
  steamid: string;
  relationship: string;
  friend_since: number;
}

interface SteamFriendsListResponse {
  friendslist?: {
    friends: SteamFriend[];
  };
}

interface SteamPlayer {
  steamid: string;
  personaname?: string;
  avatarfull?: string;
}

interface SteamPlayerSummariesResponse {
  response?: {
    players: SteamPlayer[];
  };
}

interface FriendUserIdQueryResult {
  friendUserId: number;
}

@Injectable()
export class FriendsService {
  private readonly CACHE_TTL = 300000; // 5분
  private readonly CACHE_ACHIEVEMENT_TTL = 60000; // 1분

  constructor(
    @InjectRepository(Friend)
    private readonly friendRepository: Repository<Friend>,
    @InjectRepository(OwnedGame)
    private readonly userGameRepository: Repository<OwnedGame>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly steamService: SteamService,
  ) {}

  // ==================== 친구 목록 조회 ====================

  async getFriends(
    userId: number,
    dto: GetFriendsDto,
  ): Promise<FriendListResponse> {
    const traceId = `tr_${uuidv4().substring(0, 10)}`;

    try {
      // 0. Input Validation (보안)
      this.validateGetFriendsInput(userId, dto);

      // 1. 캐시 확인 (최적화)
      if (!dto.force) {
        const cached = await this.getFriendsFromCache(userId, dto);
        if (cached) {
          return { ...cached, trace_id: traceId };
        }
      }

      // 2. User 존재 확인 (보안)
      const user = await this.userRepository.findOne({
        where: { id: userId },
        select: ['id', 'steamId'],
      });

      if (!user) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      // 3. 기본 쿼리 생성 (최적화: JOIN으로 N+1 방지)
      const query = this.friendRepository
        .createQueryBuilder('friend')
        .leftJoinAndSelect('friend.friend', 'friendUser') // ← friendUser가 아닌 friend 관계 사용
        .where('friend.userId = :userId', { userId })
        .andWhere('friend.status = :status', { status: FriendStatus.ACCEPTED });

      // 4. 검색 적용 (보안: 파라미터화된 쿼리)
      if (dto.q && dto.q.trim()) {
        query.andWhere('friendUser.personaName ILIKE :search', {
          search: `%${dto.q.trim()}%`,
        });
      }

      // 5. 통계 포함 여부 확인
      const includeStats = dto.include?.includes('stats') ?? false;
      const needsFiltering = dto.filter && dto.filter.length > 0;

      // 6. 통계 계산 및 필터링 (최적화: 필요할 때만)
      let statsMapForItems: Map<number, FriendStats> | null = null;

      let total: number;

      if (includeStats || needsFiltering) {
        // 친구 userId(friendId)만 먼저 가져오기
        const friendIdsResult = await query
          .clone()
          .select('friendUser.id', 'friendUserId') // 별칭으로 raw 키 고정
          .getRawMany<FriendUserIdQueryResult>();

        const allFriendUserIds: number[] = friendIdsResult
          .map((r) => Number(r.friendUserId))
          .filter((n) => Number.isFinite(n));

        if (allFriendUserIds.length === 0) {
          return this.buildEmptyResponse(dto, traceId);
        }

        // 통계 계산 (friendUserId 기준)
        statsMapForItems = await this.calculateFriendsStatsOptimized(
          userId,
          allFriendUserIds,
        );

        // 필터 적용
        if (needsFiltering) {
          const filteredFriendUserIds = this.applyStatsFilter(
            statsMapForItems,
            dto.filter!,
          );

          if (filteredFriendUserIds.length === 0) {
            return this.buildEmptyResponse(dto, traceId);
          }

          query.andWhere('friendUser.id IN (:...filteredIds)', {
            filteredIds: filteredFriendUserIds,
          });

          total = filteredFriendUserIds.length;
        } else {
          total = allFriendUserIds.length;
        }
      } else {
        // 통계 불필요할 때는 count만
        total = await query.getCount();
      }

      // 7. 정렬 적용
      this.applyFriendsSorting(query, dto.sort);

      // 8. 페이징 적용 (보안: 범위 검증)
      const skip = (dto.page - 1) * dto.size;
      if (skip >= total) {
        return this.buildEmptyResponse(dto, traceId);
      }

      query.skip(skip).take(dto.size);

      // 9. 데이터 조회 (최적화: 이미 JOIN됨)
      const friends = await query.getMany();

      // 10. 응답 구성
      const items: FriendItem[] = friends.map((friend) =>
        this.buildFriendItemSync(
          friend,
          includeStats ? statsMapForItems : null,
        ),
      );

      const response: FriendListResponse = {
        summary: {
          total,
          stale: false,
        },
        items,
        paging: {
          page: dto.page,
          size: dto.size,
          total,
        },
        links: {
          self: this.buildFriendsListSelfLink(dto),
          refresh: this.buildFriendsListRefreshLink(),
        },
        trace_id: traceId,
      };

      // 11. 캐시 저장 (최적화)
      if (!dto.force) {
        await this.saveFriendsToCache(userId, dto, response);
      }

      return response;
    } catch (error) {
      console.error(`[${traceId}] 친구 목록 조회 오류:`, error);

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new InternalServerErrorException({
        error: {
          code: 'INTERNAL_ERROR',
          message: '친구 목록 조회 중 오류가 발생했습니다.',
        },
        trace_id: traceId,
      });
    }
  }

  /**
   * Steam API에서 친구 목록을 가져와서 DB에 동기화
   */
  async syncFriendsFromSteam(user: User, steamApiKey: string): Promise<void> {
    try {
      console.log(
        `🔄 친구 목록 동기화 시작: userId=${user.id}, steamId=${user.steamId}`,
      );

      // 1. Steam API 호출
      const { data } = await axios.get<SteamFriendsListResponse>(
        'https://api.steampowered.com/ISteamUser/GetFriendList/v0001/',
        {
          params: {
            key: steamApiKey,
            steamid: user.steamId,
            relationship: 'friend',
          },
          timeout: 5000,
        },
      );

      const steamFriends = data?.friendslist?.friends ?? [];
      console.log(`📊 Steam에서 가져온 친구 수: ${steamFriends.length}`);

      if (steamFriends.length === 0) {
        console.log('✅ 친구가 없음 - 동기화 완료');
        return;
      }

      // 2. 친구들의 Steam ID 목록
      const friendSteamIds: string[] = steamFriends.map((f) => f.steamid);

      // 3. 친구들을 User 테이블에 upsert
      await this.ensureFriendUsersExist(friendSteamIds, steamApiKey);

      // 4. DB에서 친구 User 정보 조회
      const friendUsers = await this.userRepository.find({
        where: { steamId: In(friendSteamIds) },
        select: ['id', 'steamId'],
      });

      const steamIdToUserId = new Map<string, number>();
      friendUsers.forEach((u) => {
        steamIdToUserId.set(u.steamId, u.id);
      });

      // 5. 기존 친구 관계 조회
      const existingFriends = await this.friendRepository.find({
        where: { userId: user.id },
        select: ['friendId'],
      });

      const existingFriendIds = new Set(existingFriends.map((f) => f.friendId));

      // 6. 새로운 친구 관계만 추가
      const newFriends: Friend[] = [];

      for (const steamFriend of steamFriends) {
        const friendSteamId = steamFriend.steamid;

        // 이미 존재하는 관계는 스킵
        if (existingFriendIds.has(friendSteamId)) {
          continue;
        }

        const friend = this.friendRepository.create({
          userId: user.id,
          friendId: friendSteamId,
          status: FriendStatus.ACCEPTED,
          friend_since: new Date(steamFriend.friend_since * 1000),
        });

        newFriends.push(friend);
      }

      // 7. 일괄 저장
      if (newFriends.length > 0) {
        await this.friendRepository.save(newFriends);
        console.log(`✅ 새로운 친구 ${newFriends.length}명 추가됨`);
      } else {
        console.log('✅ 이미 모든 친구가 동기화되어 있음');
      }

      console.log(`✅ 친구 목록 동기화 완료: 총 ${steamFriends.length}명`);
    } catch (error) {
      console.error('❌ 친구 목록 동기화 실패:', error);
    }
  }

  /**
   * 친구 User들이 DB에 없으면 생성
   */
  private async ensureFriendUsersExist(
    friendSteamIds: string[],
    steamApiKey: string,
  ): Promise<void> {
    try {
      // 1. 이미 존재하는 유저 확인
      const existingUsers = await this.userRepository.find({
        where: { steamId: In(friendSteamIds) },
        select: ['steamId'],
      });

      const existingSteamIds = new Set(existingUsers.map((u) => u.steamId));

      // 2. 없는 유저들만 필터링
      const missingSteamIds = friendSteamIds.filter(
        (id) => !existingSteamIds.has(id),
      );

      if (missingSteamIds.length === 0) {
        return;
      }

      console.log(`📝 새로운 친구 User ${missingSteamIds.length}명 생성 중...`);

      // 3. Steam API로 친구들의 프로필 정보 가져오기
      const { data } = await axios.get<SteamPlayerSummariesResponse>(
        'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/',
        {
          params: {
            key: steamApiKey,
            steamids: missingSteamIds.join(','),
          },
          timeout: 5000,
        },
      );

      const players = data?.response?.players ?? [];

      // 4. User 생성
      const newUsers = players.map((player) =>
        this.userRepository.create({
          steamId: player.steamid,
          personaName: player.personaname ?? null,
          avatar: player.avatarfull ?? null,
        }),
      );

      if (newUsers.length > 0) {
        await this.userRepository.save(newUsers);
        console.log(`✅ 친구 User ${newUsers.length}명 생성 완료`);
      }
    } catch (error) {
      console.error('❌ 친구 User 생성 실패:', error);
    }
  }

  // ==================== getFriends 헬퍼 메서드 ====================

  private async getFriendsFromCache(
    userId: number,
    dto: GetFriendsDto,
  ): Promise<FriendListResponse | null> {
    try {
      const cacheKey = this.generateFriendsCacheKey(userId, dto);
      const cached = await this.cacheManager.get<FriendListResponse>(cacheKey);
      return cached ?? null;
    } catch (error) {
      console.error('캐시 조회 실패:', error);
      return null;
    }
  }

  private async saveFriendsToCache(
    userId: number,
    dto: GetFriendsDto,
    response: FriendListResponse,
  ): Promise<void> {
    try {
      const cacheKey = this.generateFriendsCacheKey(userId, dto);
      const TTL = 600;
      await this.cacheManager.set(cacheKey, response, TTL);
    } catch (error) {
      console.error('캐시 저장 실패:', error);
    }
  }

  private generateFriendsCacheKey(userId: number, dto: GetFriendsDto): string {
    const parts: string[] = [
      'friends:list',
      String(userId),
      String(dto.page),
      String(dto.size),
      dto.q || '',
      dto.sort || '',
      (dto.filter || []).sort().join(','),
      (dto.include || []).sort().join(','),
    ];
    return parts.join(':');
  }

  private async calculateFriendsStatsOptimized(
    userId: number,
    friendUserIds: number[],
  ): Promise<Map<number, FriendStats>> {
    const statsMap = new Map<number, FriendStats>();
    if (friendUserIds.length === 0) return statsMap;

    // 배치 크기 제한 (메모리 최적화)
    const BATCH_SIZE = 50;
    for (let i = 0; i < friendUserIds.length; i += BATCH_SIZE) {
      const batch = friendUserIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (fid) => {
          const stats = await this.calculateSingleFriendStats(userId, fid);
          statsMap.set(fid, stats);
        }),
      );
    }
    return statsMap;
  }

  private async calculateSingleFriendStats(
    userId: number,
    friendUserId: number,
  ): Promise<FriendStats> {
    const [mutualOwned, recentOverlap, friendUser] = await Promise.all([
      this.calculateMutualOwnedOptimized(userId, friendUserId),
      this.calculateRecentOverlapOptimized(userId, friendUserId),
      this.userRepository.findOne({
        where: { id: friendUserId },
        select: ['updated_at'],
      }),
    ]);

    return {
      mutual_owned: mutualOwned,
      recent_overlap: recentOverlap,
      last_online_at: friendUser?.updated_at?.toISOString() ?? null,
    };
  }

  private async calculateMutualOwnedOptimized(
    userId: number,
    friendUserId: number,
  ): Promise<number> {
    const result = await this.userGameRepository
      .createQueryBuilder('og1')
      .innerJoin(
        'owned_game',
        'og2',
        'og1.gameId = og2.gameId AND og2.userId = :friendUserId',
        { friendUserId },
      )
      .where('og1.userId = :userId', { userId })
      .getCount();

    return result;
  }

  private async calculateRecentOverlapOptimized(
    userId: number,
    friendUserId: number,
  ): Promise<number> {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const result = await this.userGameRepository
      .createQueryBuilder('og1')
      .innerJoin(
        'owned_game',
        'og2',
        'og1.gameId = og2.gameId AND og2.userId = :friendUserId',
        { friendUserId },
      )
      .where('og1.userId = :userId', { userId })
      .andWhere('og1.lastPlayedAt >= :twoWeeksAgo', { twoWeeksAgo })
      .andWhere('og2.lastPlayedAt >= :twoWeeksAgo', { twoWeeksAgo })
      .getCount();

    return result;
  }

  private applyFriendsSorting(
    query: SelectQueryBuilder<Friend>,
    sort: string | undefined,
  ): void {
    switch (sort) {
      case 'name':
        query.orderBy('friendUser.personaName', 'ASC', 'NULLS LAST');
        break;
      case 'last_online':
        query.orderBy('friendUser.updated_at', 'DESC', 'NULLS LAST');
        break;
      default:
        query.orderBy('friend.created_at', 'DESC');
        break;
    }
  }

  private buildFriendItemSync(
    friend: Friend,
    statsMap: Map<number, FriendStats> | null,
  ): FriendItem {
    const steamId = friend.friend?.steamId ?? ''; // string로 고정
    const personaName = friend.friend?.personaName ?? null;
    const avatar = friend.friend?.avatar ?? null;

    const item: FriendItem = {
      steamid: steamId,
      persona_name: personaName,
      avatar: avatar,
      relationship: friend.status as 'friend' | 'pending' | 'blocked',
      links: {
        profile: `/api/v1/friends/${steamId}`,
        common_games: `/api/v1/friends/${steamId}/common-games`,
        compare_achievements: `/api/v1/friends/${steamId}/games/{gameId}/achievements/compare`,
      },
    };
    // statsMap은 내부 User.id(number)로 키잉되어 있음
    const friendUserId = friend.friend?.id;
    if (statsMap && friendUserId != null) {
      const stats = statsMap.get(friendUserId);
      if (stats) item.stats = stats;
    }

    return item;
  }

  private buildEmptyResponse(
    dto: GetFriendsDto,
    traceId: string,
  ): FriendListResponse {
    return {
      summary: { total: 0, stale: false },
      items: [],
      paging: { page: dto.page, size: dto.size, total: 0 },
      links: {
        self: this.buildFriendsListSelfLink(dto),
        refresh: this.buildFriendsListRefreshLink(),
      },
      trace_id: traceId,
    };
  }

  private validateGetFriendsInput(userId: number, dto: GetFriendsDto): void {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new BadRequestException('올바르지 않은 사용자 ID입니다.');
    }

    if (dto.q && dto.q.length > 100) {
      throw new BadRequestException('검색어는 100자를 초과할 수 없습니다.');
    }

    if (dto.page > 1000) {
      throw new BadRequestException('페이지 번호는 1000을 초과할 수 없습니다.');
    }
  }

  private applyStatsFilter(
    statsMap: Map<number, FriendStats>,
    filters: ('recent_overlap' | 'mutual_only')[],
  ): number[] {
    return Array.from(statsMap.entries())
      .filter(([, stats]) => {
        let pass = true;
        if (filters.includes('mutual_only'))
          pass = pass && stats.mutual_owned > 0;
        if (filters.includes('recent_overlap'))
          pass = pass && stats.recent_overlap > 0;
        return pass;
      })
      .map(([friendUserId]) => friendUserId);
  }

  private buildFriendsListSelfLink(dto: GetFriendsDto): string {
    const params = new URLSearchParams();
    params.append('page', dto.page.toString());
    params.append('size', dto.size.toString());
    if (dto.q) params.append('q', dto.q);
    if (dto.sort) params.append('sort', dto.sort);
    if (dto.filter) params.append('filter', dto.filter.join(','));
    if (dto.include) params.append('include', dto.include.join(','));

    return `/api/v1/friends?${params.toString()}`;
  }

  private buildFriendsListRefreshLink(): string {
    return '/api/v1/friends?force=true';
  }

  // ==================== 친구 관리 메서드 ====================

  async invalidateFriendsCacheForUser(userId: number): Promise<void> {
    try {
      const redisStore = this.cacheManager.stores as unknown as RedisCache;

      if (redisStore && typeof redisStore.keys === 'function') {
        const pattern = `friends:list:${userId}:*`;
        const keys: string[] = await redisStore.keys(pattern);

        if (keys && keys.length > 0) {
          await Promise.all(keys.map((key) => this.cacheManager.del(key)));
        }
      } else {
        console.warn(
          `Pattern-based cache invalidation not supported for user ${userId}`,
        );
      }
    } catch (error) {
      console.error('캐시 무효화 중 오류 발생:', error);
    }
  }

  async addFriend(userId: number, friendUserId: number): Promise<Friend> {
    if (userId === friendUserId) {
      throw new BadRequestException('자기 자신을 친구로 추가할 수 없습니다.');
    }

    // User 조회하여 steamId 얻기
    const friendUser = await this.userRepository.findOne({
      where: { id: friendUserId },
      select: ['id', 'steamId'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    const existing = await this.friendRepository.findOne({
      where: { userId, friendId: friendUser.steamId }, // Friend.friendId는 User.steamId
    });

    if (existing) {
      throw new BadRequestException('이미 친구 관계입니다.');
    }

    const friend = this.friendRepository.create({
      userId,
      friendId: friendUser.steamId, // steamId 저장
      status: FriendStatus.PENDING,
    });

    const saved = await this.friendRepository.save(friend);
    await this.invalidateFriendsCacheForUser(userId);

    return saved;
  }

  async acceptFriend(userId: number, friendUserId: number): Promise<Friend> {
    // User 조회하여 steamId 얻기
    const [user, friendUser] = await Promise.all([
      this.userRepository.findOne({
        where: { id: userId },
        select: ['id', 'steamId'],
      }),
      this.userRepository.findOne({
        where: { id: friendUserId },
        select: ['id', 'steamId'],
      }),
    ]);

    if (!user || !friendUser) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const friend = await this.friendRepository.findOne({
      where: {
        userId: friendUserId,
        friendId: friendUser.steamId, // 요청 보낸 사람이 보낸 대상의 steamId
        status: FriendStatus.PENDING,
      },
    });

    if (!friend) {
      throw new BadRequestException('친구 요청을 찾을 수 없습니다.');
    }

    friend.status = FriendStatus.ACCEPTED;
    const updated = await this.friendRepository.save(friend);

    const reverseFriend = this.friendRepository.create({
      userId,
      friendId: friendUser.steamId, // 역방향도 steamId
      status: FriendStatus.ACCEPTED,
    });
    await this.friendRepository.save(reverseFriend);

    await Promise.all([
      this.invalidateFriendsCacheForUser(userId),
      this.invalidateFriendsCacheForUser(friendUserId),
    ]);

    return updated;
  }

  async removeFriend(userId: number, friendUserId: number): Promise<void> {
    // User 조회하여 steamId 얻기
    const [user, friendUser] = await Promise.all([
      this.userRepository.findOne({
        where: { id: userId },
        select: ['id', 'steamId'],
      }),
      this.userRepository.findOne({
        where: { id: friendUserId },
        select: ['id', 'steamId'],
      }),
    ]);

    if (!user || !friendUser) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    await this.friendRepository.delete([
      { userId, friendId: friendUser.steamId },
      { userId: friendUserId, friendId: user.steamId },
    ]);

    await Promise.all([
      this.invalidateFriendsCacheForUser(userId),
      this.invalidateFriendsCacheForUser(friendUserId),
    ]);
  }

  async blockFriend(userId: number, friendUserId: number): Promise<Friend> {
    // User 조회하여 steamId 얻기
    const friendUser = await this.userRepository.findOne({
      where: { id: friendUserId },
      select: ['id', 'steamId'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    let friend = await this.friendRepository.findOne({
      where: { userId, friendId: friendUser.steamId },
    });

    if (!friend) {
      friend = this.friendRepository.create({
        userId,
        friendId: friendUser.steamId,
        status: FriendStatus.BLOCKED,
      });
    } else {
      friend.status = FriendStatus.BLOCKED;
    }

    const saved = await this.friendRepository.save(friend);
    await this.invalidateFriendsCacheForUser(userId);

    return saved;
  }

  async getFriendStatus(
    userId: number,
    friendUserId: number,
  ): Promise<'none' | 'pending' | 'accepted' | 'blocked'> {
    // User 조회하여 steamId 얻기
    const friendUser = await this.userRepository.findOne({
      where: { id: friendUserId },
      select: ['id', 'steamId'],
    });

    if (!friendUser) {
      return 'none';
    }

    const friend = await this.friendRepository.findOne({
      where: { userId, friendId: friendUser.steamId },
    });

    return friend ? friend.status : 'none';
  }

  // ==================== 공통 게임 관련 메서드 ====================

  async getCommonGames(
    userId: number,
    friendUserId: number,
    dto: GetCommonGamesDto,
  ): Promise<CommonGamesResponse> {
    try {
      const traceId = `tr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      await this.validateFriendship(userId, friendUserId);

      if (!dto.force) {
        const cacheKey = this.generateCommonGamesCacheKey(
          userId,
          friendUserId,
          dto,
        );
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) {
          return cached as CommonGamesResponse;
        }
      }

      const [user, friend] = await Promise.all([
        this.userRepository.findOne({
          where: { id: userId },
          select: ['id', 'steamId', 'personaName'],
        }),
        this.userRepository.findOne({
          where: { id: friendUserId },
          select: ['id', 'steamId', 'personaName'],
        }),
      ]);

      if (!user || !friend) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      const [userGamesResponse, friendGamesResponse] = await Promise.all([
        this.steamService.getOwnedGames(user.steamId),
        this.steamService.getOwnedGames(friend.steamId),
      ]);

      const commonGames = this.findCommonGamesDetailed(
        userGamesResponse.games || [],
        friendGamesResponse.games || [],
      );

      let filteredGames = commonGames;
      if (dto.search && typeof dto.search === 'string') {
        const searchLower = dto.search.toLowerCase();
        filteredGames = commonGames.filter((game) =>
          game.name.toLowerCase().includes(searchLower),
        );
      }

      if (dto.filter) {
        filteredGames = this.applyOverlapFilter(filteredGames, dto.filter);
      }

      const sortedGames = this.sortCommonGamesDetailed(
        filteredGames,
        dto.sortBy,
      );

      const summary = this.calculateCommonGamesSummary(commonGames);

      const total = sortedGames.length;
      const skip = (dto.page - 1) * dto.limit;
      const paginatedGames = sortedGames.slice(skip, skip + dto.limit);

      const response: CommonGamesResponse = {
        friend: {
          steamid: friend.steamId,
          persona_name: friend.personaName || 'Unknown',
        },
        summary,
        items: paginatedGames,
        paging: {
          page: dto.page,
          size: dto.limit,
          total,
        },
        links: {
          self: this.buildCommonGamesSelfLink(friend.steamId, dto),
          refresh: this.buildCommonGamesRefreshLink(friend.steamId),
        },
        trace_id: traceId,
      };

      if (!dto.force) {
        const cacheKey = this.generateCommonGamesCacheKey(
          userId,
          friendUserId,
          dto,
        );
        await this.cacheManager.set(cacheKey, response, this.CACHE_TTL);
      }

      return response;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        '공통 게임 조회 중 오류가 발생했습니다.',
      );
    }
  }

  private async validateFriendship(
    userId: number,
    friendUserId: number,
  ): Promise<void> {
    if (userId === friendUserId) {
      throw new BadRequestException('자기 자신과는 비교할 수 없습니다.');
    }

    // friendUserId로 User 조회하여 steamId 얻기
    const friendUser = await this.userRepository.findOne({
      where: { id: friendUserId },
      select: ['id', 'steamId'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    const friendship = await this.friendRepository.findOne({
      where: {
        userId,
        friendId: friendUser.steamId, // steamId로 확인
        status: FriendStatus.ACCEPTED,
      },
    });

    if (!friendship) {
      throw new ForbiddenException('친구 관계가 아니거나 승인되지 않았습니다.');
    }
  }

  private findCommonGamesDetailed(
    userGames: Array<{
      appid: number;
      name?: string;
      playtime_forever: number;
      playtime_2weeks?: number;
      img_icon_url?: string;
      rtime_last_played?: number;
    }>,
    friendGames: Array<{
      appid: number;
      name?: string;
      playtime_forever: number;
      playtime_2weeks?: number;
      img_icon_url?: string;
      rtime_last_played?: number;
    }>,
  ): CommonGame[] {
    const friendGamesMap = new Map(
      friendGames.map((game) => [game.appid, game]),
    );

    const commonGames: CommonGame[] = [];

    for (const userGame of userGames) {
      const friendGame = friendGamesMap.get(userGame.appid);
      if (friendGame) {
        const recentOverlap =
          (userGame.playtime_2weeks || 0) > 0 &&
          (friendGame.playtime_2weeks || 0) > 0;

        commonGames.push({
          app_id: userGame.appid,
          name: userGame.name || 'Unknown Game',
          icon: this.steamService.buildAppHeaderUrl(userGame.appid),
          you: {
            playtime_forever: userGame.playtime_forever || 0,
            playtime_2weeks: userGame.playtime_2weeks,
            last_played_at: userGame.rtime_last_played
              ? new Date(userGame.rtime_last_played * 1000).toISOString()
              : undefined,
          },
          friend: {
            playtime_forever: friendGame.playtime_forever || 0,
            playtime_2weeks: friendGame.playtime_2weeks,
            last_played_at: friendGame.rtime_last_played
              ? new Date(friendGame.rtime_last_played * 1000).toISOString()
              : undefined,
          },
          overlap: {
            recent: recentOverlap,
            installed: true,
          },
        });
      }
    }

    return commonGames;
  }

  private applyOverlapFilter(
    games: CommonGame[],
    filter: 'recent_overlap' | 'installed_overlap',
  ): CommonGame[] {
    switch (filter) {
      case 'recent_overlap':
        return games.filter((game) => game.overlap.recent);
      case 'installed_overlap':
        return games.filter((game) => game.overlap.installed);
      default:
        return games;
    }
  }

  private sortCommonGamesDetailed(
    games: CommonGame[],
    sortBy?:
      | 'name'
      | 'you_playtime'
      | 'friend_playtime'
      | 'last_played'
      | 'recent_overlap',
  ): CommonGame[] {
    const sorted = [...games];

    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;

      case 'you_playtime':
        sorted.sort((a, b) => b.you.playtime_forever - a.you.playtime_forever);
        break;

      case 'friend_playtime':
        sorted.sort(
          (a, b) => b.friend.playtime_forever - a.friend.playtime_forever,
        );
        break;

      case 'last_played':
        sorted.sort((a, b) => {
          const aTime = a.you.last_played_at || a.friend.last_played_at || '';
          const bTime = b.you.last_played_at || b.friend.last_played_at || '';
          return bTime.localeCompare(aTime);
        });
        break;

      case 'recent_overlap':
        sorted.sort((a, b) => {
          if (a.overlap.recent && !b.overlap.recent) return -1;
          if (!a.overlap.recent && b.overlap.recent) return 1;
          return 0;
        });
        break;

      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    return sorted;
  }

  private calculateCommonGamesSummary(games: CommonGame[]) {
    const total = games.length;
    const recentOverlap = games.filter((game) => game.overlap.recent).length;

    return {
      total,
      recent_overlap: recentOverlap,
    };
  }

  private buildCommonGamesSelfLink(
    steamid: string,
    dto: GetCommonGamesDto,
  ): string {
    const params = new URLSearchParams({
      page: dto.page.toString(),
      size: dto.limit.toString(),
      sort: dto.sortBy || 'name',
    });
    if (dto.filter) params.append('filter', dto.filter);
    if (dto.search) params.append('search', dto.search);
    if (dto.lang) params.append('lang', dto.lang);

    return `/api/v1/friends/${steamid}/common-games?${params.toString()}`;
  }

  private buildCommonGamesRefreshLink(steamid: string): string {
    return `/api/v1/friends/${steamid}/common-games?force=true`;
  }

  private generateCommonGamesCacheKey(
    userId: number,
    friendUserId: number,
    dto: GetCommonGamesDto,
  ): string {
    const [id1, id2] = [String(userId), String(friendUserId)].sort();

    const params: (string | number)[] = [
      id1,
      id2,
      dto.page,
      dto.limit,
      dto.search || '',
      dto.sortBy || 'name',
      dto.filter || '',
      dto.lang || 'korean',
      dto.force ? '1' : '0',
    ];

    return `friends:common-games:${params.join(':')}`;
  }

  async invalidateCommonGamesCache(
    userId: number,
    friendUserId: number,
  ): Promise<void> {
    try {
      const redisStore = this.cacheManager.stores as unknown as RedisCache;

      if (redisStore && typeof redisStore.keys === 'function') {
        const [id1, id2] = [String(userId), String(friendUserId)].sort();
        const pattern = `friends:common-games:${id1}:${id2}:*`;
        const keys: string[] = await redisStore.keys(pattern);

        if (keys && keys.length > 0) {
          await Promise.all(keys.map((key) => this.cacheManager.del(key)));
        }
      }
    } catch (error) {
      console.error('공통 게임 캐시 무효화 중 오류 발생:', error);
    }
  }

  // ==================== 업적 비교 관련 메서드 ====================

  async getAchievementCompare(
    userId: number,
    friendUserId: number,
    gameId: number,
    dto: GetAchievementCompareDto,
  ): Promise<AchievementCompareResponse> {
    try {
      const traceId = `tr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      await this.validateFriendship(userId, friendUserId);

      if (!dto.force) {
        const cacheKey = this.generateAchievementCompareCacheKey(
          userId,
          friendUserId,
          gameId,
          dto,
        );
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) {
          return cached as AchievementCompareResponse;
        }
      }

      const [user, friend] = await Promise.all([
        this.userRepository.findOne({
          where: { id: userId },
          select: ['id', 'steamId', 'personaName', 'avatar'],
        }),
        this.userRepository.findOne({
          where: { id: friendUserId },
          select: ['id', 'steamId', 'personaName', 'avatar'],
        }),
      ]);

      if (!user || !friend) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      const [userAchievements, friendAchievements, gameSchema] =
        await Promise.all([
          this.steamService.getPlayerAchievements(user.steamId, gameId),
          this.steamService.getPlayerAchievements(friend.steamId, gameId),
          this.steamService.getSchemaForGame(gameId),
        ]);

      if (!gameSchema?.availableGameStats?.achievements) {
        throw new NotFoundException('게임 업적 정보를 찾을 수 없습니다.');
      }

      const achievements = this.buildComparedAchievements(
        gameSchema.availableGameStats.achievements,
        userAchievements.achievements || [],
        friendAchievements.achievements || [],
        dto.includeGlobal,
      );

      const filteredAchievements = this.applyFilter(achievements, dto.filter);
      const sortedAchievements = this.applySort(
        filteredAchievements,
        dto.short,
      );
      const summary = this.calculateSummary(achievements);

      const total = sortedAchievements.length;
      const skip = (dto.page - 1) * dto.size;
      const paginatedAchievements = sortedAchievements.slice(
        skip,
        skip + dto.size,
      );

      const response: AchievementCompareResponse = {
        game: {
          app_id: gameId,
          name: gameSchema.gameName,
          icon: this.steamService.buildAppHeaderUrl(gameId),
        },
        friend: {
          steamid: friend.steamId,
          persona_name: friend.personaName || 'Unknown',
          avatar: friend.avatar || '',
        },
        summary,
        achievements: paginatedAchievements,
        paging: {
          page: dto.page,
          size: dto.size,
          total,
        },
        links: {
          self: this.buildAchievementCompareSelfLink(
            friend.steamId,
            gameId,
            dto,
          ),
          refresh: this.buildAchievementCompareRefreshLink(
            friend.steamId,
            gameId,
          ),
        },
        trace_id: traceId,
      };

      if (!dto.force) {
        const cacheKey = this.generateAchievementCompareCacheKey(
          userId,
          friendUserId,
          gameId,
          dto,
        );
        await this.cacheManager.set(cacheKey, response, 60000);
      }

      return response;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        '업적 비교 조회 중 오류가 발생했습니다.',
      );
    }
  }

  private buildComparedAchievements(
    schemaAchievements: Array<{
      name: string;
      displayName: string;
      description?: string;
      icon: string;
      icongray: string;
      hidden: 0 | 1;
    }>,
    userAchievements: Array<{
      apiname: string;
      achieved: number;
      unlocktime: number;
    }>,
    friendAchievements: Array<{
      apiname: string;
      achieved: number;
      unlocktime: number;
    }>,
    includeGlobal: boolean = false,
  ): ComparedAchievementDetail[] {
    const userAchMap = new Map(
      userAchievements.map((ach) => [ach.apiname, ach]),
    );
    const friendAchMap = new Map(
      friendAchievements.map((ach) => [ach.apiname, ach]),
    );

    return schemaAchievements.map((schemaAch) => {
      const userAch = userAchMap.get(schemaAch.name);
      const friendAch = friendAchMap.get(schemaAch.name);

      const youUnlocked = userAch?.achieved === 1;
      const friendUnlocked = friendAch?.achieved === 1;

      let status:
        | 'friend_missing'
        | 'you_missing'
        | 'both_unlocked'
        | 'both_missing';
      if (youUnlocked && friendUnlocked) {
        status = 'both_unlocked';
      } else if (youUnlocked && !friendUnlocked) {
        status = 'friend_missing';
      } else if (!youUnlocked && friendUnlocked) {
        status = 'you_missing';
      } else {
        status = 'both_missing';
      }

      return {
        api_name: schemaAch.name,
        display_name: schemaAch.displayName,
        description: schemaAch.description || '',
        you: {
          unlocked: youUnlocked,
          unlock_time: userAch?.unlocktime
            ? new Date(userAch.unlocktime * 1000).toISOString()
            : null,
        },
        friend: {
          unlocked: friendUnlocked,
          unlock_time: friendAch?.unlocktime
            ? new Date(friendAch.unlocktime * 1000).toISOString()
            : null,
        },
        status,
        global: includeGlobal ? { percent: 0 } : null,
      };
    });
  }

  private applyFilter(
    achievements: ComparedAchievementDetail[],
    filter?:
      | 'you_missing'
      | 'friend_missing'
      | 'both_unlocked'
      | 'both_missing',
  ): ComparedAchievementDetail[] {
    if (!filter) return achievements;
    return achievements.filter((ach) => ach.status === filter);
  }

  private applySort(
    achievements: ComparedAchievementDetail[],
    sort?:
      | 'status'
      | 'friend_missing'
      | 'you_missing'
      | 'both_unlocked'
      | 'name'
      | 'rarity',
  ): ComparedAchievementDetail[] {
    const sorted = [...achievements];

    switch (sort) {
      case 'status': {
        const statusOrder = {
          you_missing: 1,
          friend_missing: 2,
          both_unlocked: 3,
          both_missing: 4,
        };
        sorted.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
        break;
      }

      case 'friend_missing':
        sorted.sort((a, b) => {
          if (a.status === 'friend_missing' && b.status !== 'friend_missing')
            return -1;
          if (a.status !== 'friend_missing' && b.status === 'friend_missing')
            return 1;
          return 0;
        });
        break;

      case 'you_missing':
        sorted.sort((a, b) => {
          if (a.status === 'you_missing' && b.status !== 'you_missing')
            return -1;
          if (a.status !== 'you_missing' && b.status === 'you_missing')
            return 1;
          return 0;
        });
        break;

      case 'both_unlocked':
        sorted.sort((a, b) => {
          if (a.status === 'both_unlocked' && b.status !== 'both_unlocked')
            return -1;
          if (a.status !== 'both_unlocked' && b.status === 'both_unlocked')
            return 1;
          return 0;
        });
        break;

      case 'name':
        sorted.sort((a, b) => a.display_name.localeCompare(b.display_name));
        break;

      case 'rarity':
        sorted.sort((a, b) => {
          const aPercent = a.global?.percent || 100;
          const bPercent = b.global?.percent || 100;
          return aPercent - bPercent;
        });
        break;
    }

    return sorted;
  }

  private calculateSummary(achievements: ComparedAchievementDetail[]) {
    const youUnlocked = achievements.filter((a) => a.you.unlocked).length;
    const friendUnlocked = achievements.filter((a) => a.friend.unlocked).length;
    const bothUnlocked = achievements.filter(
      (a) => a.you.unlocked && a.friend.unlocked,
    ).length;
    const onlyYou = achievements.filter(
      (a) => a.you.unlocked && !a.friend.unlocked,
    ).length;
    const onlyFriend = achievements.filter(
      (a) => !a.you.unlocked && a.friend.unlocked,
    ).length;
    const total = achievements.length;

    return {
      you_unlocked: youUnlocked,
      friend_unlocked: friendUnlocked,
      both_unlocked: bothUnlocked,
      only_you: onlyYou,
      only_friend: onlyFriend,
      you_completion_rate:
        total > 0 ? parseFloat((youUnlocked / total).toFixed(2)) : 0,
      friend_completion_rate:
        total > 0 ? parseFloat((friendUnlocked / total).toFixed(2)) : 0,
      total,
    };
  }

  private buildAchievementCompareSelfLink(
    steamid: string,
    gameId: number,
    dto: GetAchievementCompareDto,
  ): string {
    const params = new URLSearchParams({
      lang: dto.lang || 'korean',
      short: dto.short || 'status',
      page: dto.page.toString(),
      size: dto.size.toString(),
    });
    if (dto.filter) params.append('filter', dto.filter);
    if (dto.includeGlobal) params.append('includeGlobal', 'true');

    return `/api/v1/friends/${steamid}/games/${gameId}/achievements/compare?${params.toString()}`;
  }

  private buildAchievementCompareRefreshLink(
    steamid: string,
    gameId: number,
  ): string {
    return `/api/v1/friends/${steamid}/games/${gameId}/achievements/compare?force=true`;
  }

  private generateAchievementCompareCacheKey(
    userId: number,
    friendUserId: number,
    gameId: number,
    dto: GetAchievementCompareDto,
  ): string {
    const [id1, id2] = [String(userId), String(friendUserId)].sort();

    const params: (string | number)[] = [
      id1,
      id2,
      gameId,
      dto.page,
      dto.size,
      dto.lang || 'korean',
      dto.short || 'status',
      dto.filter || '',
      dto.includeGlobal ? '1' : '0',
      dto.force ? '1' : '0',
    ];

    return `friends:achievement-compare:${params.join(':')}`;
  }

  async invalidateAchievementCompareCache(
    userId: number,
    friendUserId: number,
    gameId: number,
  ): Promise<void> {
    try {
      const redisStore = this.cacheManager.stores as unknown as RedisCache;

      if (redisStore && typeof redisStore.keys === 'function') {
        const [id1, id2] = [String(userId), String(friendUserId)].sort();
        const pattern = `friends:achievement-compare:${id1}:${id2}:${gameId}:*`;
        const keys: string[] = await redisStore.keys(pattern);

        if (keys && keys.length > 0) {
          await Promise.all(keys.map((key) => this.cacheManager.del(key)));
        }
      }
    } catch (error) {
      console.error('업적 비교 캐시 무효화 중 오류 발생:', error);
    }
  }
}
