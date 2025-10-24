import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { errorSummary } from '../../common/error.util';

const API = 'https://api.steampowered.com';

type OwnedGamesResponse = {
  response: {
    game_count?: number;
    games?: Array<{
      appid: number;
      name?: string;
      playtime_forever: number;
      playtime_2weeks?: number;
      img_icon_url?: string;
      has_community_visible_stats: boolean;
      rtime_last_played?: number;
    }>;
  };
};

type ResolveVanityResponse = {
  response: {
    success: 1 | 42; // 1 = 성공, 42 = "일치하는 항목 없음" 오류
    steamid?: string;
    message?: string;
  };
};

type PlayerAchievementsResponse = {
  playerstats: {
    steamID: string;
    gameName: string;
    achievements?: Array<{
      apiname: string;
      achieved: 0 | 1;
      unlocktime: number;
      name?: string;
      description?: string;
    }>;
    success: boolean;
    error?: string;
  };
};

type SchemaForGameResponse = {
  game: {
    gameName: string;
    gameVersion: string;
    availableGameStats?: {
      achievements?: Array<{
        name: string;
        defaultvalue: number;
        displayName: string;
        hidden: 0 | 1;
        description?: string;
        icon: string;
        icongray: string;
      }>;
      stats?: Array<{
        name: string;
        defaultvalue: number;
        displayName: string;
      }>;
    };
  };
};

@Injectable()
export class SteamService {
  private readonly key: string;
  private readonly http: AxiosInstance;

  constructor(cfg: ConfigService) {
    this.key = cfg.getOrThrow<string>('STEAM_API_KEY');
    this.http = axios.create({
      baseURL: API,
      timeout: 10000,
      headers: { 'User-Agent': 'steam-integration/1.0' },
    });
  }

  // 보유 게임 목록
  async getOwnedGames(
    steamId64: string,
  ): Promise<OwnedGamesResponse['response']> {
    if (!steamId64 || !/^\d{17}$/.test(steamId64)) {
      throw new BadRequestException('올바르지 않은 Steam ID64 형식입니다');
    }

    try {
      const { data } = await this.http.get<OwnedGamesResponse>(
        `/IPlayerService/GetOwnedGames/v1/`,
        {
          params: {
            key: this.key,
            steamid: steamId64,
            include_appinfo: 1,
            include_played_free_games: 1,
          },
        },
      );
      return data?.response ?? { game_count: 0, games: [] };
    } catch (e: unknown) {
      throw new InternalServerErrorException(
        `Steam GetOwnedGames failed: ${errorSummary(e)}`,
      );
    }
  }

  // steam 닉네임을 숫자 id로 바꾸는 변환용
  async resolveVanity(
    vanity: string,
  ): Promise<ResolveVanityResponse['response']> {
    try {
      const { data } = await this.http.get<ResolveVanityResponse>(
        `/ISteamUser/ResolveVanityURL/v1/`,
        {
          params: { key: this.key, vanityurl: vanity },
        },
      );

      if (data.response.success === 42) {
        throw new NotFoundException(
          `Steam 닉네임 URL "${vanity}"을(를) 찾을 수 없습니다`,
        );
      }

      return data.response;
    } catch (e: unknown) {
      throw new InternalServerErrorException(
        `Steam ResolveVanity failed: ${errorSummary(e)}`,
      );
    }
  }

  buildAppIconUrl(appId: number, iconHash?: string): string | null {
    if (!iconHash) return null;
    return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${iconHash}.jpg`;
  }

  buildAppHeaderUrl(appid: number): string {
    return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
  }

  // 플레이어 업적 정보 가져오기
  async getPlayerAchievements(
    steamId64: string,
    appId: number,
  ): Promise<PlayerAchievementsResponse['playerstats']> {
    try {
      const { data } = await this.http.get<PlayerAchievementsResponse>(
        `/ISteamUserStats/GetPlayerAchievements/v1/`,
        {
          params: {
            key: this.key,
            steamid: steamId64,
            appid: appId,
            l: 'korean',
          },
        },
      );
      return data.playerstats;
    } catch (e: unknown) {
      throw new InternalServerErrorException(
        `Steam GetPlayerAchievements failed: ${errorSummary(e)}`,
      );
    }
  }

  // 게임의 업적 스키마 가져오기
  async getSchemaForGame(
    appId: number,
  ): Promise<SchemaForGameResponse['game']> {
    try {
      const { data } = await this.http.get<SchemaForGameResponse>(
        `/ISteamUserStats/GetSchemaForGame/v2/`,
        {
          params: {
            key: this.key,
            appid: appId,
            l: 'korean',
          },
        },
      );
      return data.game;
    } catch (e: unknown) {
      throw new InternalServerErrorException(
        `Steam GetSchemaForGame failed: ${errorSummary(e)}`,
      );
    }
  }
}
