// summaryDTO

import { ownedGameDto } from './ownedGame.dto';

export class SummaryDto {
  total_games!: number;
  total_playtime_minutes!: number;
  recent_playtime_2weeks_minutes!: number;
  most_played_game!: ownedGameDto | null;
  last_played_at!: Date;
}
