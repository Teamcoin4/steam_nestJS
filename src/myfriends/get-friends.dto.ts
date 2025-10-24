import {
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsString,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class GetFriendsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 30;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(['name', 'mutual_owned', 'recent_overlap', 'last_online'])
  sort?: 'name' | 'mutual_owned' | 'recent_overlap' | 'last_online';

  @IsOptional()
  @Transform(({ value }): ('recent_overlap' | 'mutual_only')[] | undefined => {
    if (typeof value === 'string') {
      return value.split(',').map((v) => v.trim()) as (
        | 'recent_overlap'
        | 'mutual_only'
      )[];
    }
    return value;
  })
  @IsEnum(['recent_overlap', 'mutual_only'], { each: true })
  filter?: ('recent_overlap' | 'mutual_only')[];

  @IsOptional()
  @Transform(({ value }): 'stats'[] | undefined => {
    if (typeof value === 'string') {
      return value.split(',').map((v) => v.trim()) as 'stats'[];
    }
    return value;
  })
  @IsEnum(['stats'], { each: true })
  include?: 'stats'[];

  @IsOptional()
  @Transform(({ value }): boolean => value === 'true' || value === true)
  @IsBoolean()
  force?: boolean = false;
}

// 응답 타입 정의
export interface FriendStats {
  mutual_owned: number;
  recent_overlap: number;
  last_online_at: string | null;
}

export interface FriendItem {
  steamid: string;
  persona_name: string | null;
  avatar: string | null;
  relationship: 'friend' | 'pending' | 'blocked';
  privacy_state?: string;
  stats?: FriendStats;
  links: {
    profile: string;
    common_games: string;
    compare_achievements: string;
  };
}

export interface FriendListResponse {
  summary: {
    total: number;
    stale: boolean;
  };
  items: FriendItem[];
  paging: {
    page: number;
    size: number;
    total: number;
  };
  links: {
    self: string;
    refresh: string;
  };
  trace_id: string;
}

// 내부 쿼리 결과 타입
export interface FriendIdQueryResult {
  friend_friendId: number;
}

// Redis 캐시 인터페이스
export interface RedisCache {
  keys: (pattern: string) => Promise<string[]>;
  del: (key: string) => Promise<void>;
}
