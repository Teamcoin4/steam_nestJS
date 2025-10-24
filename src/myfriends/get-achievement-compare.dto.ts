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

export class GetAchievementCompareDto {
  @ApiPropertyOptional({ description: '업적 표시 언어', default: 'korean' })
  @IsOptional()
  @IsString()
  lang?: string = 'korean';

  @ApiPropertyOptional({
    enum: [
      'status',
      'friend_missing',
      'you_missing',
      'both_unlocked',
      'name',
      'rarity',
    ],
    description: '정렬 기준',
    default: 'status',
  })
  @IsOptional()
  @IsEnum([
    'status',
    'friend_missing',
    'you_missing',
    'both_unlocked',
    'name',
    'rarity',
  ])
  short?:
    | 'status'
    | 'friend_missing'
    | 'you_missing'
    | 'both_unlocked'
    | 'name'
    | 'rarity' = 'status';

  @ApiPropertyOptional({
    enum: ['you_missing', 'friend_missing', 'both_unlocked', 'both_missing'],
    description: '필터 조건',
  })
  @IsOptional()
  @IsEnum(['you_missing', 'friend_missing', 'both_unlocked', 'both_missing'])
  filter?: 'you_missing' | 'friend_missing' | 'both_unlocked' | 'both_missing';

  @ApiPropertyOptional({
    description: '글로벌 달성률 포함 여부',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeGlobal?: boolean = false;

  @ApiPropertyOptional({ description: '캐시 무시하고 최신화', default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force?: boolean = false;

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
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 50;
}

export interface ComparedAchievementDetail {
  api_name: string;
  display_name: string;
  description: string;
  you: {
    unlocked: boolean;
    unlock_time: string | null;
  };
  friend: {
    unlocked: boolean;
    unlock_time: string | null;
  };
  status: 'friend_missing' | 'you_missing' | 'both_unlocked' | 'both_missing';
  global: {
    percent: number;
  } | null;
}

export interface AchievementCompareResponse {
  game: {
    app_id: number;
    name: string;
    icon: string;
  };
  friend: {
    steamid: string;
    persona_name: string;
    avatar: string;
  };
  summary: {
    you_unlocked: number;
    friend_unlocked: number;
    both_unlocked: number;
    only_you: number;
    only_friend: number;
    you_completion_rate: number;
    friend_completion_rate: number;
    total: number;
  };
  achievements: ComparedAchievementDetail[];
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
