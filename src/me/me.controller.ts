import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
  Patch,
  Body,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MeService } from './me.service';
import { Envelope, MeProfileDto } from './dto/me-profile.dto';
import { ListMyGamesDto } from './dto/list-my-games.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserId } from 'src/auth/user-id.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { NoStoreInterceptor } from 'src/common/interceptors/no-store.interceptor';

function parseBool(s?: string) {
  return s === 'true' || s === '1' || s === 't' || s === 'yes';
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  // 내 게임 목록 조회
  @UseInterceptors(NoStoreInterceptor)
  @UseGuards(JwtAuthGuard)
  @Get('games')
  async listMyGames(
    @UserId() userId: number,
    @Query() q: ListMyGamesDto,
    @Query('force') force?: string,
  ) {
    return this.meService.listMyGames(userId, q, parseBool(force));
  }

  // 내 프로필 조회
  @ApiOperation({ summary: '현재 로그인한 사용자의 기본 프로필 반환' })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          id: 1,
          steamId: '76561198000355602',
          personaName: 'kim',
          avatar: 'https://.../avatarfull.jpg',
          createdAt: '2025-09-06T08:30:00Z',
          updatedAt: '2025-09-30T09:00:00Z',
        },
        error: null,
      },
    },
  })
  @ApiUnauthorizedResponse({
    schema: {
      example: {
        data: null,
        error: { code: 'unauthorized', message: 'Login required' },
      },
    },
  })
  @ApiForbiddenResponse({
    schema: {
      example: {
        data: null,
        error: { code: 'forbidden', message: 'Account is restricted' },
      },
    },
  })
  @ApiNotFoundResponse({
    schema: {
      example: {
        data: null,
        error: { code: 'user_not_found', message: 'Profile not found' },
      },
    },
  })
  @ApiTooManyRequestsResponse({
    schema: {
      example: {
        data: null,
        error: { code: 'too_many_requests', message: 'Try again later' },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(NoStoreInterceptor)
  @Get()
  async getMe(@UserId() userId: number): Promise<Envelope<MeProfileDto>> {
    const data = await this.meService.getMeByUserId(userId);
    return { data, error: null };
  }

  // 프로필 업데이트
  @ApiOperation({ summary: '사용자 프로필 정보 수정' })
  @ApiOkResponse({
    schema: {
      example: {
        data: { message: 'Profile updated successfully' },
        error: null,
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(NoStoreInterceptor)
  @Patch()
  async updateProfile(
    @UserId() userId: number,
    @Body() patch: UpdateProfileDto,
  ): Promise<Envelope<{ message: string }>> {
    await this.meService.updateProfile(userId, patch);
    return { data: { message: 'Profile updated successfully' }, error: null };
  }
}
