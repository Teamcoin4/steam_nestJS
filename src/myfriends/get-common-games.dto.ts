import {
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsString,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetCommonGamesDto {
  @ApiPropertyOptional({ description: '페이지 번호', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: '페이지당 항목 수',
    minimum: 1,
    maximum: 100,
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;

  @ApiPropertyOptional({
    enum: [
      'name',
      'you_playtime',
      'friend_playtime',
      'last_played',
      'recent_overlap',
    ],
    description: '정렬 기준',
    default: 'name',
  })
  @IsOptional()
  @IsEnum([
    'name',
    'you_playtime',
    'friend_playtime',
    'last_played',
    'recent_overlap',
  ])
  sortBy?:
    | 'name'
    | 'you_playtime'
    | 'friend_playtime'
    | 'last_played'
    | 'recent_overlap' = 'name';

  @ApiPropertyOptional({
    enum: ['recent_overlap', 'installed_overlap'],
    description: '필터 조건',
  })
  @IsOptional()
  @IsEnum(['recent_overlap', 'installed_overlap'])
  filter?: 'recent_overlap' | 'installed_overlap';

  @ApiPropertyOptional({ description: '캐시 무시하고 최신화', default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force?: boolean = false;

  @ApiPropertyOptional({ description: '표시 언어', default: 'korean' })
  @IsOptional()
  @IsString()
  lang?: string = 'korean';

  @ApiPropertyOptional({ description: '검색어' })
  @IsOptional()
  @IsString()
  search?: string;
}

// Response 타입 정의
export interface CommonGame {
  app_id: number;
  name: string;
  icon: string;
  you: {
    playtime_forever: number;
    playtime_2weeks?: number;
    last_played_at?: string;
  };
  friend: {
    playtime_forever: number;
    playtime_2weeks?: number;
    last_played_at?: string;
  };
  overlap: {
    recent: boolean;
    installed: boolean;
  };
}

export interface CommonGamesResponse {
  friend: {
    steamid: string;
    persona_name: string;
  };
  summary: {
    total: number;
    recent_overlap: number;
  };
  items: CommonGame[];
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
