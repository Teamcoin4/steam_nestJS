// userAchievementDTO

import { UserDto } from './user.dto';
import { AchievementDto } from './achievement.dto';

type UserIdMapped = { userId: UserDto['id'] };
type AchievementGameIdMapped = { gameId: AchievementDto['gameId'] };
type AchievementApiNameMapped = { apiName: AchievementDto['apiName'] };

export class userAchievementDto
  implements AchievementApiNameMapped, AchievementGameIdMapped, UserIdMapped
{
  id!: number;
  userId!: number;
  gameId!: number;
  apiName!: string;
  name!: string;
  description?: string;
  hidden!: boolean;
  icon?: string;
  created_at?: Date;
  updated_at?: Date;
}
