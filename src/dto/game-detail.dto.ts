import { AchievementDto } from './achievement.dto';
import { Game } from '../domain/games/game.entity';

/** 🎯 GameDetailDto: 게임 기본정보 + 업적 상세 목록 */
export class GameDetailDto {
  /** 게임 기본 정보 */
  game!: Pick<Game, 'gameId' | 'title' | 'icon'>;

  /** 업적 목록 (유저 달성 상태 포함) */
  achievements!: AchievementDto[];
}
