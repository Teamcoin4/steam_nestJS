import { Type, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { lowerCase, emptyToUndef, trimString } from 'src/common/transformers';

export class ListMyGamesDto {
  @IsOptional()
  @IsIn(['playtimeForever', 'playtime2Weeks', 'gameId', 'name', 'lastPlayedAt'])
  sort?:
    | 'playtimeForever'
    | 'playtime2Weeks'
    | 'gameId'
    | 'name'
    | 'lastPlayedAt';
  @IsOptional()
  @Transform(lowerCase, { toClassOnly: true })
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';

  @Transform(emptyToUndef, { toClassOnly: true })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Transform(emptyToUndef, { toClassOnly: true })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100)
  size = 30;

  @IsOptional()
  @Transform(trimString, { toClassOnly: true })
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
