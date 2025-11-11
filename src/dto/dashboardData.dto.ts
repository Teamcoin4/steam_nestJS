// src/dto/dashboardData.dto.ts

import { SummaryDto } from './summary.dto';
import { ownedGameDto } from './ownedGame.dto';
import { FriendDto } from './friends.dto';

/**
 * 🎮 Steam Dashboard Data DTO
 * - 대시보드 전체 데이터를 구성하는 통합 DTO
 * - Game / OwnedGame / Achievement / UserAchievement 동기화 결과 포함
 */
export class DashboardDataDto {
  /** 🧑‍💻 사용자 프로필 정보 */
  profile!: {
    steamid: string;
    personaName: string;
    avatar?: string;
  };

  /** 📊 요약 통계 (게임 수, 플레이타임 등) */
  summary!: SummaryDto;

  /** 🕹️ 최근 플레이한 게임 목록 */
  recently_played!: ownedGameDto[];

  /** 🏆 전체 업적 달성 현황 */
  achievement_progress!: {
    /** 총 달성 업적 수 */
    earned: number;
    /** 전체 업적 수 */
    total: number;
    /** 달성률 (0~100, 소수점 2자리 고정) */
    ratio: number;
    /** 최근에 달성한 업적 (optional, UI용 확장) */
    recent_achievements?: {
      gameId: number;
      apiName: string;
      displayName: string;
      unlockedAt: Date;
    }[];
  };

  /** 🤝 친구 목록 */
  friends!: {
    /** 친구 수 */
    count: number;
    /** 친구 리스트 (간략 정보 포함) */
    list?: FriendDto[];
  };

  /** 🔗 빠른 이동 링크 */
  quick_links!: {
    games: string;
    friends: string;
    achievements: string;
  };
}
