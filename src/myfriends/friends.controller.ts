// src/myfriends/friends.controller.ts
import {
  Controller,
  Get,
  Query,
  ValidationPipe,
  UseGuards,
  Post,
  Delete,
  Param,
  ParseIntPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FriendsService } from './friends.service';
import { User } from '../domain/users/user.entity';
import { UserId } from '../auth/user-id.decorator';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetFriendsDto } from './get-friends.dto';
import { GetCommonGamesDto } from './get-common-games.dto';
import { GetAchievementCompareDto } from './get-achievement-compare.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Friends')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(
    private readonly friendsService: FriendsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  // ✅ 1. 업적 비교 (가장 구체적인 경로가 먼저)
  @Get(':steamid/games/:gameid/achievements/compare')
  @UseGuards(ThrottlerGuard)
  async getAchievementCompare(
    @UserId() userId: string,
    @Param('steamid', ParseIntPipe) friendSteamId: number,
    @Param(
      'gameid',
      new ParseIntPipe({
        errorHttpStatusCode: 400,
        exceptionFactory: () =>
          new BadRequestException('gameId must be a positive integer'),
      }),
    )
    gameId: number,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    )
    query: GetAchievementCompareDto,
  ) {
    // gameId 검증 추가
    if (gameId <= 0) {
      throw new BadRequestException('gameId must be a positive integer');
    }

    const userIdNum = parseInt(userId, 10);

    const friendUser = await this.userRepository.findOne({
      where: { steamId: friendSteamId },
      select: ['id'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    return this.friendsService.getAchievementCompare(
      userIdNum,
      friendUser.id,
      gameId,
      query,
    );
  }

  // ✅ 2. 공통 게임 조회
  @Get(':steamid/common-games')
  @UseGuards(ThrottlerGuard)
  async getCommonGames(
    @UserId() userId: string,
    @Param('steamid', ParseIntPipe) friendSteamId: number,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    )
    query: GetCommonGamesDto,
  ) {
    const userIdNum = parseInt(userId, 10);

    // steamId로 User 조회
    const friendUser = await this.userRepository.findOne({
      where: { steamId: friendSteamId },
      select: ['id'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    return this.friendsService.getCommonGames(userIdNum, friendUser.id, query);
  }

  // ✅ 3. 친구 상태 확인
  @Get(':steamid/status')
  @UseGuards(ThrottlerGuard)
  async getFriendStatus(
    @UserId() userId: string,
    @Param('steamid', ParseIntPipe) friendSteamId: number,
  ) {
    const userIdNum = parseInt(userId, 10);

    // steamId로 User 조회
    const friendUser = await this.userRepository.findOne({
      where: { steamId: friendSteamId },
      select: ['id'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    return this.friendsService.getFriendStatus(userIdNum, friendUser.id);
  }

  // ✅ 4. 친구 목록 조회 (동적 경로보다 나중에)
  @Get()
  @UseGuards(ThrottlerGuard)
  async getFriends(
    @UserId() userId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    )
    query: GetFriendsDto,
  ) {
    const userIdNum = parseInt(userId, 10);
    return this.friendsService.getFriends(userIdNum, query);
  }

  // ✅ 5. 친구 추가
  @Post(':steamid')
  @UseGuards(ThrottlerGuard)
  async addFriend(
    @UserId() userId: string,
    @Param('steamid', ParseIntPipe) friendSteamId: number,
  ) {
    const userIdNum = parseInt(userId, 10);

    // steamId로 User 조회
    const friendUser = await this.userRepository.findOne({
      where: { steamId: friendSteamId },
      select: ['id'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    return this.friendsService.addFriend(userIdNum, friendUser.id);
  }

  // ✅ 6. 친구 요청 승인
  @Post(':steamid/accept')
  @UseGuards(ThrottlerGuard)
  async acceptFriend(
    @UserId() userId: string,
    @Param('steamid', ParseIntPipe) friendSteamId: number,
  ) {
    const userIdNum = parseInt(userId, 10);

    // steamId로 User 조회
    const friendUser = await this.userRepository.findOne({
      where: { steamId: friendSteamId },
      select: ['id'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    return this.friendsService.acceptFriend(userIdNum, friendUser.id);
  }

  // ✅ 7. 친구 삭제
  @Delete(':steamid')
  @UseGuards(ThrottlerGuard)
  async removeFriend(
    @UserId() userId: string,
    @Param('steamid', ParseIntPipe) friendSteamId: number,
  ) {
    const userIdNum = parseInt(userId, 10);

    // steamId로 User 조회
    const friendUser = await this.userRepository.findOne({
      where: { steamId: friendSteamId },
      select: ['id'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    return this.friendsService.removeFriend(userIdNum, friendUser.id);
  }

  // ✅ 8. 친구 차단
  @Post(':steamid/block')
  @UseGuards(ThrottlerGuard)
  async blockFriend(
    @UserId() userId: string,
    @Param('steamid', ParseIntPipe) friendSteamId: number,
  ) {
    const userIdNum = parseInt(userId, 10);

    // steamId로 User 조회
    const friendUser = await this.userRepository.findOne({
      where: { steamId: friendSteamId },
      select: ['id'],
    });

    if (!friendUser) {
      throw new NotFoundException('친구를 찾을 수 없습니다.');
    }

    return this.friendsService.blockFriend(userIdNum, friendUser.id);
  }
}
