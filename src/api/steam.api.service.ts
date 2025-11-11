import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios, { AxiosInstance, AxiosResponse } from 'axios';

// ✅ 공통 타입 정의
type QueryParams = Record<string, string | number | boolean>;

// 안전한 Axios 응답 타입
type SafeAxiosResponse<T> = AxiosResponse<T, unknown, Record<string, unknown>>;

// 🧱 Steam API 원시 응답 구조
interface SteamOwnedGameRaw {
  appid: number;
  name: string;
  playtime_forever?: number;
  img_icon_url?: string;
  img_logo_url?: string;
}

interface OwnedGamesApiResponse {
  response?: {
    game_count?: number;
    games?: SteamOwnedGameRaw[];
  };
}

// Steam GetPlayerAchievements 응답 타입 정의
export interface PlayerAchievement {
  apiname: string;
  achieved: 0 | 1;
  unlockedAt?: number;
}

export interface PlayerStats {
  gameName?: string;
  steamID?: string;
  achievements?: PlayerAchievement[];
  success?: boolean;
}

export interface PlayerAchievementsApiResponse {
  playerstats?: PlayerStats;
}

// 🎮 내부에서 사용하는 도메인 타입
export interface OwnedGame {
  appId: number;
  name: string;
  playtimeForever: number;
  icon?: string | null;
  logo?: string | null;
}

export interface SteamFriend {
  steamid: string;
  relationship: string;
  friend_since: number;
}

interface FriendListApiResponse {
  friendslist?: { friends?: SteamFriend[] };
}

export interface PlayerSummary {
  steamid: string;
  personaname?: string;
  profileurl?: string;
  avatar?: string;
  avatarmedium?: string;
  avatarfull?: string;
  personastate?: number;
  lastlogoff?: number;
}

interface PlayerSummariesApiResponse {
  response?: { players?: PlayerSummary[] };
}

export interface AchievementSchema {
  name: string;
  displayName?: string;
  description?: string;
  hidden?: number; // 0 | 1
  icon?: string;
  icongray?: string;
}

export interface GameSchema {
  gameName?: string;
  availableGameStats?: {
    achievements?: AchievementSchema[];
  };
}

interface SchemaForGameApiResponse {
  game?: GameSchema;
}

export interface GlobalAchievementPercent {
  name: string;
  percent: number;
}

interface GlobalAchievementPercentagesApiResponse {
  achievementpercentages?: {
    achievements?: GlobalAchievementPercent[];
  };
}

// 🧠 에러 요약 헬퍼
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

  private async httpGet<T>(url: string, params: QueryParams): Promise<T> {
    const res: SafeAxiosResponse<T> = await this.client.get<
      T,
      SafeAxiosResponse<T>
    >(url, { params });
    return res.data;
  }

  // ✅ appid → appId로 안전 변환 (null 방지)
  async getOwnedGames(steamId64: string): Promise<OwnedGame[]> {
    const data = await this.httpGet<OwnedGamesApiResponse>(
      '/IPlayerService/GetOwnedGames/v0001',
      {
        key: this.key,
        steamid: steamId64,
        include_appinfo: 1,
        include_played_free_games: 1,
      },
    );

    const games = data.response?.games ?? [];

    // 🚧 appid가 없거나 잘못된 게임은 제외
    return games
      .filter(
        (g): g is SteamOwnedGameRaw =>
          typeof g.appid === 'number' && g.appid > 0 && !!g.name,
      )
      .map((g) => ({
        appId: g.appid,
        name: g.name,
        playtimeForever: g.playtime_forever ?? 0,
        icon: g.img_icon_url ?? null,
        logo: g.img_logo_url ?? null,
      }));
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
      { key: this.key, appId },
    );
    return data.game ?? {};
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

  async getFriendList(steamId64: string): Promise<SteamFriend[]> {
    const data = await this.httpGet<FriendListApiResponse>(
      '/ISteamUser/GetFriendList/v1',
      { key: this.key, steamid: steamId64, relationship: 'friend' },
    );
    const friends = data.friendslist?.friends ?? [];
    return friends.filter(
      (f): f is SteamFriend =>
        !!f &&
        typeof f.steamid === 'string' &&
        typeof f.relationship === 'string' &&
        typeof f.friend_since === 'number',
    );
  }

  async getPlayerAchievements(
    appId: number,
    steamId64: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await this.httpGet<Record<string, unknown>>(
        '/ISteamUserStats/GetPlayerAchievements/v1',
        { key: this.key, appId, steamid: steamId64 },
      );
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
}
