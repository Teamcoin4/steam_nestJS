// friendsDTO

export class FriendDto {
  id!: number;
  userId!: number;
  friendId!: string;
  friend_since?: Date | null;
  created_at!: Date;
  updated_at!: Date;
}
