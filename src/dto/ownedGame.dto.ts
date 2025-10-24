// OwendGameDTO

import { UserDto } from './user.dto';
import { GameDto } from './game.dto';

type UserIdMapped = { userId: UserDto['id'] };
type GameIdMapped = { gameId: GameDto['gameId'] };
type GameTitleMapped = { title: GameDto['title'] };
type GameIconMapped = { icon: GameDto['icon'] };

export class ownedGameDto
  implements UserIdMapped, GameIdMapped, GameTitleMapped, GameIconMapped
{
  /* 공백오류 */ id!: number;
  userId!: number;
  gameId!: number;
  title!: string;
  icon: string | undefined;
  playtime_forever!: number;
  playtime_2weeks!: number;
  created_at!: Date;
  updated_at!: Date;
  last_played_at!: Date;
}
