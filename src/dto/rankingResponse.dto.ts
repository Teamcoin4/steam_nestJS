import { RankingEntryDto } from '../dto/rankingEntry.dto';

export class RankingResponseDto {
  scope!: 'global' | 'friends';
  totalUsers!: number;
  totalAchievements!: number;
  items!: RankingEntryDto[];
  myEntry!: RankingEntryDto; // 상단 고정용
}
