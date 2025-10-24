import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';

type QueryParams = Record<string, string | number | boolean>;
type SafeAxiosResponse<T> = AxiosResponse<T, unknown, Record<string, unknown>>;

// Strongly-typed Steam Web API responses
export type OwnedGame = {
  appid: number;
  name?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  img_icon_url?: string;
  img_logo_url?: string;
  has_community_visible_stats?: boolean;
};
interface OwnedGamesApiResponse {
  response?: { game_count?: number; games?: OwnedGame[] };
}

export type SteamFriend = {
  steamid: string;
  relationship: string;
  friend_since: number;
};

interface FriendListApiResponse {
  friendslist?: { friends?: SteamFriend[] };
}

export type PlayerSummary = {
  steamid: string;
  personaname?: string;
  profileurl?: string;
  avatar?: string;
  avatarmedium?: string;
  avatarfull?: string;
  personastate?: number;
  lastlogoff?: number;
};
interface PlayerSummariesApiResponse {
  response?: { players?: PlayerSummary[] };
}

export type AchievementSchema = {
  name: string;
  displayName?: string;
  description?: string;
  hidden?: number; // 0 | 1
  icon?: string;
  icongray?: string;
};
export type GameSchema = {
  gameName?: string;
  gameVersion?: string;
  availableGameStats?: { achievements?: AchievementSchema[] };
};
interface SchemaForGameApiResponse {
  game?: GameSchema;
}

export type PlayerAchievement = {
  apiname: string;
  achieved: 0 | 1;
  unlocktime?: number; // unix seconds
};
export type PlayerStats = {
  gameName?: string;
  steamID?: string;
  achievements?: PlayerAchievement[];
  success?: boolean;
};
interface PlayerAchievementsApiResponse {
  playerstats?: PlayerStats;
}

export type GlobalAchievementPercent = { name: string; percent: number };
interface GlobalAchievementPercentagesApiResponse {
  achievementpercentages?: { achievements?: GlobalAchievementPercent[] };
}

// 에러 요약 헬퍼: unknown 안전 처리
function errorSummary(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const code = err.response?.status;
    const msg = typeof err.message === 'string' ? err.message : 'AxiosError';
    return code ? `${code} ${msg}` : msg;
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

@Injectable()
export class SteamApiService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.STEAM_API_BASE ?? 'https://api.steampowered.com',
      timeout: 10_000,
    });
  }

  private get key(): string {
    return process.env.STEAM_API_KEY as string;
  }

  // AxiosInstance 기반 호출: ESLint no-unsafe-* 경고 제거
  private async httpGet<T>(url: string, params: QueryParams): Promise<T> {
    const res: SafeAxiosResponse<T> = await this.client.get<
      T,
      SafeAxiosResponse<T>
    >(url, { params });
    return res.data;
  }

  async getOwnedGames(steamId64: string) {
    const data = await this.httpGet<OwnedGamesApiResponse>(
      '/IPlayerService/GetOwnedGames/v0001',
      {
        key: this.key,
        steamid: steamId64,
        include_appinfo: 1,
        include_played_free_games: 1,
      },
    );
    return data.response?.games ?? [];
  }

  async getPlayerSummaries(steamIds: string[]): Promise<PlayerSummary[]> {
    const data = await this.httpGet<PlayerSummariesApiResponse>(
      '/ISteamUser/GetPlayerSummaries/v2',
      { key: this.key, steamids: steamIds.join(',') },
    );
    return data.response?.players ?? [];
  }

  async getSchemaForGame(appId: number): Promise<GameSchema> {
    const data = await this.httpGet<SchemaForGameApiResponse>(
      '/ISteamUserStats/GetSchemaForGame/v2',
      { key: this.key, appid: appId },
    );
    return data.game ?? {};
  }

  // 업적이 없거나 비공개(400/403/404)면 null 반환
  async getPlayerAchievements(
    appId: number,
    steamId64: string,
  ): Promise<PlayerAchievementsApiResponse | null> {
    try {
      const data = await this.httpGet<PlayerAchievementsApiResponse>(
        '/ISteamUserStats/GetPlayerAchievements/v1',
        { key: this.key, appid: appId, steamid: steamId64 },
      );
      return data;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response) {
        const code = err.response.status;
        if (code === 400 || code === 403 || code === 404) return null;
      }
      throw new InternalServerErrorException(
        `Steam GetPlayerAchievements failed: ${errorSummary(err)}`,
      );
    }
  }

  async getFriendList(steamId64: string) {
    const data = await this.httpGet<FriendListApiResponse>(
      '/ISteamUser/GetFriendList/v1',
      { key: this.key, steamid: steamId64, relationship: 'friend' },
    );
    const arr = data.friendslist?.friends ?? [];
    return arr.filter(
      (f): f is SteamFriend =>
        !!f &&
        typeof f.steamid === 'string' &&
        typeof f.relationship === 'string' &&
        typeof f.friend_since === 'number',
    );
  }

  async getGlobalAchievementPercentages(
    appId: number,
  ): Promise<GlobalAchievementPercent[]> {
    const data = await this.httpGet<GlobalAchievementPercentagesApiResponse>(
      '/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2',
      { gameid: appId },
    );
    return data.achievementpercentages?.achievements ?? [];
  }
}
