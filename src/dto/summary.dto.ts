// src/dto/summary.dto.ts

export class SummaryDto {
  total_games!: number;
  total_playtime_minutes!: number;
  recent_playtime_2weeks_minutes!: number;
  most_played_game!: {
    gameId: number;
    title: string;
    playtime_forever: number;
    icon?: string;
  } | null;
  last_played_at!: Date;
}
