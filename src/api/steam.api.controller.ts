import {
  Controller,
  Post,
  Param,
  Req,
  UnauthorizedException,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { UpsertService } from './upsert.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/** ✅ 로그인된 사용자 정보를 명시적으로 정의 */
interface AuthUser {
  id: number;
  steamId: string;
}

@Controller('steam')
@UseGuards(JwtAuthGuard)
export class SteamController {
  private readonly controllerName = SteamController.name;

  constructor(private readonly sync: UpsertService) {}

  /** 🔹 전체 동기화: 보유 게임, 업적, 친구 정보 */
  @Post('sync/all')
  async syncAll(@Req() req: Request): Promise<{ games: number }> {
    console.log('👀 req.user in SteamController:', req.user);
    console.log('[SteamController] req.user =', req.user);
    const user = req.user as AuthUser | undefined;
    if (!user) throw new UnauthorizedException('로그인이 필요합니다.');

    if (!user.steamId || !user.id)
      throw new BadRequestException('유효하지 않은 사용자 정보입니다.');

    // ✅ 문자열 SteamID64로 변환 (Steam API 호환)
    const steamId64 = String(user.steamId);

    try {
      return await this.sync.syncUserAll(steamId64, user.id);
    } catch (err: unknown) {
      console.error(`[${this.controllerName}] syncAll failed:`, err);
      throw new BadRequestException(
        'Steam 전체 동기화 중 오류가 발생했습니다.',
      );
    }
  }

  /** 🔹 단일 게임 동기화 */
  @Post('sync/game/:appId')
  async syncGame(
    @Req() req: Request,
    @Param('appId', ParseIntPipe) appId: number,
  ): Promise<{ gameId: number }> {
    const user = req.user as AuthUser | undefined;
    if (!user) throw new UnauthorizedException('로그인이 필요합니다.');
    if (!Number.isFinite(appId) || appId <= 0)
      throw new BadRequestException('유효하지 않은 appId입니다.');

    try {
      const result = await this.sync.syncOneGame(
        String(user.steamId),
        user.id,
        appId,
      );
      return result as { gameId: number }; // ✅ 타입 명시로 ESLint 경고 제거
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown Steam Sync Error';
      console.error(`[SteamController] syncGame(${appId}) failed:`, message);
      throw new BadRequestException(`Steam 게임 동기화 오류: ${message}`);
    }
  }
}
