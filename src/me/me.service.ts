import {
  Injectable,
  NotFoundException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { OwnedGameRepository } from 'src/domain/games/owned-game.repository';
import { ListMyGamesDto } from './dto/list-my-games.dto';
import { UsersRepository } from 'src/domain/users/users.repository';
import { MeProfileDto } from './dto/me-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CacheAsideService } from 'src/common/cache/cache-aside.service';
import {
  profileKey,
  profileIdx,
  myGamesKey,
  myGamesIdx,
} from 'src/common/cache/keys';
import { SteamSyncService } from 'src/api/steam-sync.service';

/** 🎯 게임 목록 아이템의 안전한 반환 형태 */
export interface MyGameListItem {
  appId: number;
  name: string;
  icon: string | null;
  playtimeForever: number;
  playtime2Weeks: number;
  lastPlayedAt: Date | null;
  achievements?: {
    supported: boolean;
    unlocked: number;
    total: number;
    completion_rate: number;
  };
}

export interface ListMyGamesResult {
  page: number;
  size: number;
  total: number;
  items: MyGameListItem[];
}

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly ownedRepo: OwnedGameRepository,
    private readonly usersRepo: UsersRepository,
    private readonly cache: CacheAsideService,
    @Inject(forwardRef(() => SteamSyncService))
    private readonly steamSync: SteamSyncService,
  ) {}

  /**
   * 🎮 내 게임 목록 조회 (+ 캐시)
   */
  async listMyGames(
    userId: number,
    q: ListMyGamesDto,
    force = false,
  ): Promise<ListMyGamesResult> {
    const {
      sort = 'playtimeForever',
      order = 'desc',
      page = 1,
      size = 30,
      keyword,
    } = q;
    this.logger.debug(`[MeService] listMyGames userId=${userId}`);

    const normalized = { sort, order, page, size, keyword };
    const key = myGamesKey(userId, normalized);
    const idx = myGamesIdx(userId);

    // ✅ 강제 새로고침 시 캐시 무효화 + Steam 데이터 재동기화
    if (force) {
      this.logger.log(`[Force Sync] Invalidating cache for user:${userId}`);
      await this.cache.invalidateByIndex(idx);
      try {
        const user = await this.usersRepo.findById(userId);
        if (user?.steamId) {
          await this.steamSync.syncUserData({
            id: userId,
            steamId: user.steamId,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[Force Sync] Steam sync failed: ${msg}`);
      }
    }

    // ✅ 캐시에서 안전하게 불러오기
    return this.cache.getOrLoad<ListMyGamesResult>(
      key,
      async (): Promise<ListMyGamesResult> => {
        const result = await this.ownedRepo.listForUserQB(userId, {
          sort,
          order,
          page,
          size,
          keyword,
          includeAch: true,
        });

        const items: MyGameListItem[] = Array.isArray(result.items)
          ? result.items.map((raw): MyGameListItem => {
              // result.items[i]의 구조는 listForUserQB()의 반환 형태에 따라 고정되어 있음
              const item = raw as {
                appId: number;
                name: string;
                icon?: string | null;
                you?: {
                  playtimeForever?: number;
                  playtime2Weeks?: number;
                  lastPlayedAt?: Date | null;
                };
                achievements?: {
                  supported?: boolean;
                  unlocked?: number;
                  total?: number;
                  completion_rate?: number;
                };
              };

              const you = item.you ?? {};
              const ach = item.achievements ?? {};

              return {
                appId: Number(item.appId ?? 0),
                name: String(item.name ?? ''),
                icon:
                  typeof item.icon === 'string' || item.icon === null
                    ? item.icon
                    : null,
                playtimeForever: Number(you.playtimeForever ?? 0),
                playtime2Weeks: Number(you.playtime2Weeks ?? 0),
                lastPlayedAt:
                  you.lastPlayedAt instanceof Date ? you.lastPlayedAt : null,
                achievements:
                  ach.total !== undefined
                    ? {
                        supported: Boolean(ach.supported),
                        unlocked: Number(ach.unlocked ?? 0),
                        total: Number(ach.total ?? 0),
                        completion_rate: Number(ach.completion_rate ?? 0),
                      }
                    : undefined,
              };
            })
          : [];

        const total: number = Number.isFinite(result.total) ? result.total : 0;

        return { page, size, total, items };
      },
      { ttlSec: 600, index: idx },
    );
  }

  /**
   * 👤 내 프로필 조회 (캐시 지원)
   */
  async getMeByUserId(userId: number): Promise<MeProfileDto> {
    return this.cache.getOrLoad<MeProfileDto>(
      profileKey(userId),
      async (): Promise<MeProfileDto> => {
        const user = await this.usersRepo.findById(userId);

        if (!user) throw new NotFoundException('Profile not found');

        return {
          id: user.id,
          steamId: user.steamId,
          personaName: user.personaName ?? null,
          avatar: user.avatar ?? null,
          created_at: user.created_at.toISOString(),
          updated_at: user.updated_at.toISOString(),
        };
      },
      { ttlSec: 30, index: profileIdx(userId) },
    );
  }

  /**
   * 📝 프로필 업데이트
   */
  async updateProfile(userId: number, patch: UpdateProfileDto): Promise<void> {
    await this.usersRepo.updateProfile(userId, patch);
    await this.cache.invalidateByIndex(profileIdx(userId));
  }
}
