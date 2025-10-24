import { Injectable, NotFoundException } from '@nestjs/common';
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

type ListMyGamesResult = {
  page: number;
  size: number;
  total: number;
  items: unknown[];
};

@Injectable()
export class MeService {
  constructor(
    private readonly ownedRepo: OwnedGameRepository,
    private readonly usersRepo: UsersRepository,
    private readonly cache: CacheAsideService,
  ) {}

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

    const normalized = { sort, order, page, size, keyword };
    const key = myGamesKey(userId, normalized);
    const idx = myGamesIdx(userId);

    if (force) {
      await this.cache.invalidateByIndex(idx);
    }

    return this.cache.getOrLoad<ListMyGamesResult>(
      key,
      async (): Promise<ListMyGamesResult> => {
        const result = await this.ownedRepo.listForUserQB(userId, {
          sort,
          order,
          page,
          size,
          keyword,
        });

        const items: unknown[] = Array.isArray(result.items)
          ? result.items
          : [];
        const total: number =
          typeof result.total === 'number' ? result.total : 0;

        return { page, size, total, items };
      },
      { ttlSec: 600, index: idx },
    );
  }

  async getMeByUserId(userId: number): Promise<MeProfileDto> {
    return this.cache.getOrLoad<MeProfileDto>(
      profileKey(userId),
      async (): Promise<MeProfileDto> => {
        const user = await this.usersRepo.findById(userId);

        if (!user) {
          throw new NotFoundException('Profile not found');
        }

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

  async updateProfile(userId: number, patch: UpdateProfileDto): Promise<void> {
    await this.usersRepo.updateProfile(userId, patch);
    await this.cache.invalidateByIndex(profileIdx(userId));
  }
}
