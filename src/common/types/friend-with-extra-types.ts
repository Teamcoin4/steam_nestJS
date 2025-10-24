export interface FriendWithExtra {
  id: number; // 친구 관계의 고유 ID
  userId: number; // 사용자 ID
  friendId: number; // 친구 ID
  status: string; // 친구 상태 ('pending', 'accepted', 'blocked' 등)
  created_at?: Date; // 친구 관계 생성 시간 (선택적)
  updated_at?: Date; // 친구 관계 업데이트 시간 (선택적)

  // 추가 정보 필드 (실제 프로젝트에 맞게 조정하세요)
  friendUser?: {
    // 친구 사용자 정보 (선택적)
    id: number;
    username?: string;
    profileImage?: string;
    status?: string; // 온라인 상태 등
  };

  // 기타 필요한 추가 필드
  isOnline?: boolean;
  lastActive?: Date;
  commonGamesCount?: number;
}
