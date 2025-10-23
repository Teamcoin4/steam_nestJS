// friendsDTO

export type FriendDto = {
  id: number;
  userId: number;
  friendId: number | null; // number로 변경
  friend_since: string | null;
  created_at: string;
  updated_at: string;
};
