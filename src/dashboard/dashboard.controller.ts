import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  HttpCode,
  HttpStatus,
  Inject,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { DashboardService } from './dashboard.service';
import { DashboardResponseDto } from '../dto/dashboardResponse.dto';
import type { DashboardResponseDto as DashboardResponseDtoType } from '../dto/dashboardResponse.dto';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(AuthGuard('jwt-access'))
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * 내 대시보드 조회 (JWT userId 기준)
   * 기존 /dashboard/me → /dashboard 로 변경됨
   */
  @Get()
  @ApiOperation({ summary: '내 대시보드 조회 (JWT userId 기준)' })
  @ApiResponse({ status: 200, description: '성공', type: DashboardResponseDto })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async getMyDashboard(@Req() req: Request): Promise<DashboardResponseDtoType> {
    const user = req.user as { id: number } | undefined;
    if (!user?.id) {
      throw new Error('인증된 사용자 정보가 없습니다.');
    }

    const userId = user.id;
    const cacheKey = `dashboard:user:${userId}`;

    const cached =
      await this.cacheManager.get<DashboardResponseDtoType>(cacheKey);
    if (cached) return cached;

    const data = await this.dashboardService.getSteamDashboard(userId);
    await this.cacheManager.set(cacheKey, data, 60);
    return data;
  }

  /**
   * 특정 사용자 대시보드 조회 (userId 기반)
   */
  @Get(':userId')
  @ApiOperation({ summary: '특정 사용자 대시보드 조회' })
  @ApiResponse({ status: 200, description: '성공', type: DashboardResponseDto })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async getDashboard(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<DashboardResponseDtoType> {
    const cacheKey = `dashboard:user:${userId}`;

    const cached =
      await this.cacheManager.get<DashboardResponseDtoType>(cacheKey);
    if (cached) return cached;

    const data = await this.dashboardService.getSteamDashboard(userId);
    await this.cacheManager.set(cacheKey, data, 60);
    return data;
  }

  /**
   * 대시보드 캐시 무효화
   */
  @Post(':userId/invalidate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '대시보드 캐시 무효화' })
  @ApiResponse({ status: 200, description: '캐시 무효화 완료' })
  async invalidateDashboardCache(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ message: string }> {
    const cacheKey = `dashboard:user:${userId}`;
    await this.cacheManager.del(cacheKey);
    return { message: 'Dashboard cache invalidated' };
  }
}
