// src/dashboard/dashboard.service.ts

import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../domain/users/user.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';
import { Game } from '../domain/games/game.entity';
import { Friend } from '../domain/friends/friends.entity';
import { ownedGameDto } from '../dto/ownedGame.dto';
import { FriendDto } from '../dto/friends.dto';
import { DashboardDataDto } from '../dto/dashboardData.dto';
import { DashboardResponseDto } from '../dto/dashboardResponse.dto';
import { SummaryDto } from '../dto/summary.dto';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(OwnedGame)
    private readonly ownedGameRepository: Repository<OwnedGame>,
    @InjectRepository(Game)
    private readonly gameRepository: Repository<Game>,
    @InjectRepository(Friend)
    private readonly friendRepository: Repository<Friend>,
  ) {
    /* 공백오류 */
  }

  /**
   * 대시보드 데이터 조회 (캐싱은 컨트롤러에서 처리)
   */
  async getSteamDashboard(userId: number): Promise<DashboardResponseDto> {
    try {
      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user) {
        throw new UnauthorizedException('User session expired or not found');
      }

      const ownedGames = await this.ownedGameRepository.find({
        where: { userId },
        relations: ['game'],
      });

      const oGames: ownedGameDto[] = ownedGames.map((g) => ({
        id: g.id,
        userId: g.userId,
        gameId: g.gameId,
        title: g.game.title,
        icon: g.game.icon ?? undefined,
        playtime_forever: g.playtimeForever,
        playtime_2weeks: g.playtime2Weeks,
        created_at: g.createdAt,
        updated_at: g.updatedAt,
        last_played_at: g.lastPlayedAt ?? new Date(0),
      }));

      const mostPlayed =
        oGames.length > 0
          ? oGames.reduce((prev, curr) =>
              curr.playtime_forever > prev.playtime_forever ? curr : prev,
            )
          : null;

      const summary: SummaryDto = {
        total_games: oGames.length,
        total_playtime_minutes: oGames.reduce(
          (sum, g) => sum + g.playtime_forever,
          0,
        ),
        recent_playtime_2weeks_minutes: oGames.reduce(
          (sum, g) => sum + g.playtime_2weeks,
          0,
        ),
        most_played_game: mostPlayed ?? null,
        last_played_at: oGames[0]?.last_played_at ?? new Date(0),
      };

      const friends = await this.friendRepository.find({
        where: { userId },
      });
      const friendDtos: FriendDto[] = friends.map((f) => ({
        id: f.id,
        userId: f.userId,
        friendId: f.friendId, // number
        friend_since: f.friendSince ? f.friendSince.toISOString() : null,
        created_at: f.createdAt.toISOString(),
        updated_at: f.updatedAt.toISOString(),
      }));

      const data: DashboardDataDto = {
        profile: {
          steamid: user.steamId, // DashboardSteamProfile가 number로 변경됨
          personaName: user.personaName ?? 'Unknown',
          avatar: user.avatar ?? undefined,
        },
        summary,
        recently_played: oGames,
        achievement_progress: {
          earned: 0,
          total: 0,
          ratio: 0,
        },
        friends: {
          count: friendDtos.length,
          list: friendDtos,
        },
        quick_links: {
          games: '/games',
          friends: '/friends',
          achievements: '/achievements',
        },
      };

      return { data, error: null };
    } catch {
      throw new InternalServerErrorException('Failed to load dashboard data');
    }
  }
}
