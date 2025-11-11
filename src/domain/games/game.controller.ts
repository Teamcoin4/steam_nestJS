import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { GameService } from './game.service';
import { GameDetailDto } from 'src/dto/game-detail.dto';

@ApiTags('Games')
@Controller('/me/games')
@UseGuards(JwtAuthGuard)
export class GameController {
  constructor(private readonly gameService: GameService) {}

  /** ✅ 테스트용 엔드포인트 */
  @Get(':appId/test')
  async getGameAchievementsTest(@Param('appId', ParseIntPipe) appId: number) {
    const userId = 1; // 테스트용
    const result = await this.gameService.getAchievementsWithUserStatus(
      appId,
      userId,
    );
    if (!result) throw new NotFoundException('게임 데이터를 찾을 수 없습니다.');
    return result;
  }

  /** ✅ 실제 API (로그인 유저 기반) */
  @Get(':appId')
  async getGameDetail(
    @Param('appId', ParseIntPipe) appId: number,
    @Req() req: Request & { user?: { id: number } },
  ): Promise<GameDetailDto> {
    const userId = req.user?.id;
    if (!userId) throw new NotFoundException('로그인 정보가 없습니다.');

    const result = await this.gameService.getAchievementsWithUserStatus(
      appId,
      userId,
    );
    if (!result) throw new NotFoundException('게임 데이터를 찾을 수 없습니다.');
    return result;
  }
}
