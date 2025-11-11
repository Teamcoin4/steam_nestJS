import {
  Controller,
  Post,
  Param,
  ParseIntPipe,
  Req,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SteamSyncService } from './steam-sync.service';

@Controller('steam')
export class SteamSyncController {
  constructor(private readonly syncService: SteamSyncService) {}

  /** 🎯 단일 게임 업적 동기화 */
  @Post('game/:gameId')
  @HttpCode(200)
  async syncGameAchievements(
    @Req() req: Request,
    @Param('gameId', ParseIntPipe) gameId: number,
  ): Promise<{ success: boolean; message: string }> {
    const user = req.user as { id: number; steamId: string } | undefined;
    if (!user) throw new UnauthorizedException();

    await this.syncService.syncGameAndUserAchievements(user, gameId);

    return {
      success: true,
      message: `Achievements synced for gameId: ${gameId}`,
    };
  }
}
