// achievementDTO

import { GameDto } from './game.dto';

/** 🎮 AchievementDto: 게임 업적 + 유저 달성 정보 포함 */
type GameIdMapped = { gameId: GameDto['gameId'] };

export class AchievementDto implements GameIdMapped {
  /** 업적 ID */
  id!: number;

  /** 게임 ID */
  gameId!: number;

  /** Steam API에서 제공하는 내부 업적 키 */
  apiName!: string;

  /** 업적 이름 (Steam Display Name) */
  name!: string;

  /** 설명 (없을 수도 있음) */
  description?: string;

  /** 숨김 여부 */
  hidden!: boolean;

  /** 아이콘 URL */
  icon?: string;

  /** 생성일 */
  created_at?: Date;

  /** 수정일 */
  updated_at?: Date;

  /** ✅ 유저 달성 여부 */
  achieved?: boolean;

  /** ✅ 달성한 시점 (없으면 null) */
  unlockedAt?: string | null;
}
