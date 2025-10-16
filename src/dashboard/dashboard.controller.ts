// dashboard.controller
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
  ) {
    /* 공백오류 */
  }

  // 특정 유저 대시보드와 내 대시보드 조회를 분리하여 작성하였음
  // 내 대시보드 (@Get-/Dashboard/me)
  @Get('me')
  @ApiOperation({ summary: '내 대시보드 조회 (JWT userId 기준)' })
  @ApiResponse({ status: 200, description: '성공', type: DashboardResponseDto })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async getMyDashboard(@Req() req: Request): Promise<DashboardResponseDtoType> {
    const user = req.user as unknown as { id: number };
    const userId = user.id;
    const cacheKey = `dashboard:user:${userId}`;

    const cached =
      await this.cacheManager.get<DashboardResponseDtoType>(cacheKey); // 캐시를 조회
    if (cached) return cached;

    const data = await this.dashboardService.getSteamDashboard(userId); // 캐시가 없으면 DB에서 조회
    await this.cacheManager.set(cacheKey, data, 60); //(1분) 상황에 맞춰 변경
    return data;
  }

  // 유저 대시보드 (@Get-/Dashboard/:userId)
  // 'me'요청이 들어오면 위의 getMyDashboard가 처리하므로, 여기는 숫자형 userId만 받게됨
  @Get(':userId')
  @ApiOperation({ summary: '사용자 대시보드 조회' })
  @ApiResponse({ status: 200, description: '성공', type: DashboardResponseDto })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async getDashboard(
    @Param('userId', ParseIntPipe) userId: number, // userId가 number가 아닐시 400(Bad Request) 에러 발생
  ): Promise<DashboardResponseDtoType> {
    const cacheKey = `dashboard:user:${userId}`;
    const cached =
      await this.cacheManager.get<DashboardResponseDtoType>(cacheKey); // 캐시를 조회
    if (cached) return cached;

    const data = await this.dashboardService.getSteamDashboard(userId); // 캐시가 없으면 DB에서 조회
    await this.cacheManager.set(cacheKey, data, 60); //(1분) 상황에 맞춰 변경
    return data;
  }

  @Post(':userId/invalidate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '대시보드 캐시 무효화' })
  async invalidateDashboardCache(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ message: string }> {
    const cacheKey = `dashboard:user:${userId}`;
    await this.cacheManager.del(cacheKey);
    return { message: 'dashboard cache invalidated' };
  }
}
