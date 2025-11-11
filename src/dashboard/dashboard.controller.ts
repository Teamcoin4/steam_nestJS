import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
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

interface AuthenticatedUser {
  id: number;
  steamId: string;
}

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(AuthGuard('jwt-access'))
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * ✅ 내 대시보드 조회 (JWT userId 기준)
   */
  @Get()
  @ApiOperation({ summary: '내 대시보드 조회 (JWT userId 기준)' })
  @ApiResponse({ status: 200, description: '성공', type: DashboardResponseDto })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async getMyDashboard(
    @Req() req: AuthenticatedRequest,
  ): Promise<DashboardResponseDtoType> {
    if (!req.user?.id) {
      this.logger.warn('[Dashboard] 요청에 사용자 정보가 없습니다.');
      throw new Error('인증된 사용자 정보가 없습니다.');
    }

    const userId = req.user.id;
    this.logger.debug(`[DashboardController] GET /dashboard user:${userId}`);

    // ✅ 캐싱 로직은 서비스 내부에서 수행
    return await this.dashboardService.getSteamDashboard(userId);
  }

  /**
   * ✅ 특정 사용자 대시보드 조회 (userId 기반)
   */
  @Get(':userId')
  @ApiOperation({ summary: '특정 사용자 대시보드 조회' })
  @ApiResponse({ status: 200, description: '성공', type: DashboardResponseDto })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async getDashboardByUserId(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<DashboardResponseDtoType> {
    this.logger.debug(`[DashboardController] GET /dashboard/${userId}`);
    return await this.dashboardService.getSteamDashboard(userId);
  }

  /**
   * ✅ 대시보드 캐시 무효화 (특정 사용자)
   */
  @Post(':userId/invalidate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '특정 사용자 대시보드 캐시 무효화' })
  @ApiResponse({ status: 200, description: '캐시 무효화 완료' })
  async invalidateDashboardCache(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ message: string }> {
    await this.dashboardService.refreshDashboard(userId);
    this.logger.debug(
      `[DashboardController] Cache invalidated for user:${userId}`,
    );
    return { message: `Dashboard cache invalidated for user ${userId}` };
  }

  /**
   * ✅ 본인 캐시 직접 갱신 (JWT 사용자)
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '내 대시보드 캐시 강제 갱신' })
  @ApiResponse({ status: 200, description: '캐시 갱신 완료' })
  async refreshDashboard(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; message: string }> {
    if (!req.user?.id) {
      this.logger.warn('[Dashboard] refresh 요청에 사용자 정보가 없습니다.');
      throw new Error('인증된 사용자 정보가 없습니다.');
    }

    const userId = req.user.id;
    await this.dashboardService.refreshDashboard(userId);
    this.logger.debug(
      `[DashboardController] Cache refreshed for user:${userId}`,
    );
    return { success: true, message: `Cache refreshed for user ${userId}` };
  }
}
