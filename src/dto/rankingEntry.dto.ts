export class RankingEntryDto {
  userId!: number;
  completed!: number;
  total!: number;
  percent!: number; // 0~100
  rank!: number;
}
