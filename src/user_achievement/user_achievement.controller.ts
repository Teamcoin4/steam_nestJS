// user_achievementController
import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Req,
  Inject,
  UseGuards,
  Query,
  DefaultValuePipe,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AuthGuard } from '@nestjs/passport';
import { UserAchievementService } from './user_achievement.service';
import type { RankingResponseDto } from '../dto/rankingResponse.dto';
import type { JwtUser } from '../auth/jwt-user';

@Controller('games')
@UseGuards(AuthGuard('jwt-access'))
export class UserAchievementController {
  constructor(
    private readonly UserAchievementService: UserAchievementService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    /* 공백오류 */
  }

  // 나의 업적
  @Get(':gameId/achievements/me')
  async getUserGameAchievements(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Req() req: Request,
  ) {
    const user = req.user as JwtUser | undefined;
    if (!user || typeof user.id !== 'number') {
      throw new UnauthorizedException('Invalid accessToken');
    }
    const userId = user.id;
    const cacheKey = `user_achievements:${userId}:${gameId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const data = await this.UserAchievementService.getUserGameAchievements(
      userId,
      gameId,
    );
    await this.cacheManager.set(cacheKey, data, 300);
    return data;
  }

  // 게임별 랭킹: scope=global|friends
  @Get(':gameId/achievements/ranking')
  async getRanking(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query('scope', new DefaultValuePipe('global')) scope: 'global' | 'friends',
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Req() req: Request,
  ): Promise<RankingResponseDto> {
    const user = req.user as JwtUser | undefined;
    if (!user || typeof user.id !== 'number') {
      throw new UnauthorizedException('Invalid accessToken');
    }
    const meId = user.id;
    const cacheKey = `lb:${gameId}:${scope}:${meId}:${limit}:${offset}`;
    const cached = await this.cacheManager.get<RankingResponseDto>(cacheKey);
    if (cached) return cached;

    const data = await this.UserAchievementService.getGameLeaderboardWithMyRank(
      gameId,
      meId,
      scope,
      limit,
      offset,
    );
    await this.cacheManager.set(cacheKey, data, 120);
    return data;
  }
}

// 더미데이터 테스트용 하드코딩
// import { userAchievementDto } from '../dto/userAchievement.dto'; // 테스트용

// // 임의 유저ID 1사용 하드코딩
// @Controller('user_achievements')
// export class UserAchievementController {
//   constructor(private readonly UserAchievementService: UserAchievementService) {
//     /* 공백 오류 */
//   }
//   @Get('games/:gameId/achievements')
//   async getUserGameAchievements(
//     @Param('gameId', ParseIntPipe) gameId: number,
//   ): Promise<userAchievementDto[]> {
//     const userId = 1;
//     return this.UserAchievementService.getUserGameAchievements(userId, gameId);
//   }
// }
