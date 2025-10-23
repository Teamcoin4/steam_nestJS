// dashboardDataDTO

import { SummaryDto } from './summary.dto';
import { ownedGameDto } from './ownedGame.dto';
import { FriendDto } from './friends.dto';

export class DashboardDataDto {
  profile!: {
    steamid: string;
    personaName: string;
    avatar?: string;
  };
  summary!: SummaryDto;
  recently_played!: ownedGameDto[];
  achievement_progress!: {
    earned: number;
    total: number;
    ratio: number;
  };
  friends!: {
    count: number;
    list?: FriendDto[];
  };
  quick_links!: {
    games: string;
    friends: string;
    achievements: string;
  };
}
