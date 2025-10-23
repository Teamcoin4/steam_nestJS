import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { errorSummary } from '../../common/error.util';

const API = 'https://api.steampowered.com';

// 개별 게임 아이템 타입 (외부에서 쓰면 export)
export type OwnedGame = {
  appid: number;
  name?: string;
  playtime_forever: number;
  playtime_2weeks?: number;
  img_icon_url?: string;
  has_community_visible_stats: boolean;
  rtime_last_played?: number;
};

// 플레이어 업적 항목 타입 (외부에서 쓰면 export)
export type PlayerAchievement = {
  apiname: string;
  achieved: 0 | 1;
  unlocktime: number;
  name?: string;
  description?: string;
};

type OwnedGamesResponse = {
  response: {
    game_count?: number;
    games?: OwnedGame[];
  };
};

type ResolveVanityResponse = {
  response: {
    success: 1 | 42; // 1 = 성공, 42 = "일치하는 항목 없음"
    steamid?: string;
    message?: string;
  };
};

type PlayerAchievementsResponse = {
  playerstats: {
    steamID: string;
    gameName: string;
    achievements?: PlayerAchievement[];
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

type FriendListResponse = {
  friendslist?: {
    friends?: Array<{
      steamid: string;
      relationship: string;
      friend_since?: number;
    }>;
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
  async getOwnedGames(steamId: number): Promise<{ games: OwnedGame[] }> {
    try {
      const { data } = await this.http.get<OwnedGamesResponse>(
        `/IPlayerService/GetOwnedGames/v0001`,
        {
          params: {
            key: this.key,
            steamid: String(steamId),
            include_appinfo: 1,
            include_played_free_games: 1,
          },
        },
      );
      return { games: data.response?.games ?? [] };
    } catch (e: unknown) {
      throw new InternalServerErrorException(
        `Steam GetOwnedGames failed: ${errorSummary(e)}`,
      );
    }
  }

  // steam 닉네임을 숫자 id로 변환
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

  // 플레이어 업적 정보
  // 매개변수 순서는 (steamId, appId)
  async getPlayerAchievements(
    steamId: number,
    appId: number,
  ): Promise<{ achievements: PlayerAchievement[] }> {
    try {
      const { data } = await this.http.get<PlayerAchievementsResponse>(
        `/ISteamUserStats/GetPlayerAchievements/v1`,
        {
          params: { key: this.key, steamid: String(steamId), appid: appId },
        },
      );
      const achievements = data.playerstats?.achievements ?? [];
      return { achievements };
    } catch (e: unknown) {
      throw new InternalServerErrorException(
        `Steam GetPlayerAchievements failed: ${errorSummary(e)}`,
      );
    }
  }

  // 게임의 업적 스키마
  async getSchemaForGame(
    appId: number,
  ): Promise<SchemaForGameResponse['game']> {
    try {
      const { data } = await this.http.get<SchemaForGameResponse>(
        `/ISteamUserStats/GetSchemaForGame/v2/`,
        {
          params: { key: this.key, appid: appId, l: 'korean' },
        },
      );
      return data.game;
    } catch (e: unknown) {
      throw new InternalServerErrorException(
        `Steam GetSchemaForGame failed: ${errorSummary(e)}`,
      );
    }
  }

  // 친구 목록 가져오기 (관계: friend만)
  async getFriendList(
    steamId64: string,
  ): Promise<
    Array<{ steamid: string; relationship: 'friend'; friend_since?: number }>
  > {
    try {
      const { data } = await this.http.get<FriendListResponse>(
        '/ISteamUser/GetFriendList/v1/',
        {
          params: {
            key: this.key,
            steamid: steamId64, // 문자열 그대로 전달
            relationship: 'friend',
          },
        },
      );
      const friends = data.friendslist?.friends ?? [];
      return friends
        .filter(
          (
            f,
          ): f is {
            steamid: string;
            relationship: 'friend';
            friend_since?: number;
          } => f.relationship === 'friend',
        )
        .map((f) => ({
          steamid: f.steamid,
          relationship: 'friend',
          friend_since: f.friend_since,
        }));
    } catch (err: unknown) {
      throw new InternalServerErrorException(
        `Steam GetFriendList failed: ${errorSummary(err)}`,
      );
    }
  }

  buildAppIconUrl(appId: number, iconHash?: string): string | null {
    if (!iconHash) return null;
    return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${iconHash}.jpg`;
  }

  buildAppHeaderUrl(appId: number): string {
    return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
  }
}
