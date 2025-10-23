// achievementController
import { Controller, Get, Param, ParseIntPipe, Inject } from '@nestjs/common';
import { AchievementService } from './achievement.service';
import type { Achievement } from '../domain/achievements/achievement.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Controller('games')
export class AchievementController {
  constructor(
    private readonly achievementService: AchievementService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    /* 공백 오류 */
  }

  // 게임별 업적 목록
  @Get(':gameId/achievements')
  async getAchievements(
    @Param('gameId', ParseIntPipe) gameId: number, // gameId가 number가 아닐시 400(Bad Request) 에러 발생
  ): Promise<Achievement[]> {
    const cacheKey = `achievements:game:${gameId}`;

    const cached = await this.cacheManager.get<Achievement[]>(cacheKey); // 캐시를 조회
    if (cached) return cached;

    const data = await this.achievementService.getAchievementsByGameId(gameId); // 캐시가 없으면 DB에서 조회
    await this.cacheManager.set(cacheKey, data, 300); // (5분) 상황에 맞춰 변경
    return data;
  }
}
