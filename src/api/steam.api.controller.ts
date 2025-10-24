import {
  Controller,
  Post,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { UpsertService } from './upsert.service';

@Controller('steam')
export class SteamController {
  constructor(private readonly sync: UpsertService) {}

  // 전체 동기화
  @Post('sync/all')
  async syncAll(@Req() req: Request) {
    const user = req.user as { id: number; steamId: string } | undefined;
    if (!user) throw new UnauthorizedException();
    // syncUserAll은 문자열 SteamID64를 기대합니다.
    return this.sync.syncUserAll(String(user.steamId), user.id);
  }

  // 단일 게임 동기화
  @Post('sync/game/:appId')
  async syncGame(@Req() req: Request, @Param('appId') appIdParam: string) {
    const user = req.user as { id: number; steamId: string } | undefined;
    if (!user) throw new UnauthorizedException();
    const appId = Number(appIdParam);
    if (!Number.isFinite(appId))
      throw new UnauthorizedException('Invalid appId');
    return this.sync.syncOneGame(String(user.steamId), user.id, appId);
  }
}
