// friendService

import { Injectable } from '@nestjs/common';
import { FriendsRepository } from '../domain/friends/friends.repository';
import { FriendDto } from '../dto/friends.dto';

@Injectable()
export class FriendsService {
  constructor(private readonly friendsRepository: FriendsRepository) {
    /* 공백오류 */
  }

  async getFriendsByUserId(userId: number): Promise<FriendDto[]> {
    const friends = await this.friendsRepository.find({
      where: { userId },
    });

    return friends.map((f) => ({
      id: f.id,
      userId: f.userId,
      friendId: f.friendId,
      friend_since: f.friend_since,
      created_at: f.created_at,
      updated_at: f.updated_at,
    }));
  }

  async countFriends(userId: number): Promise<number> {
    return await this.friendsRepository.count({ where: { userId } });
  }
}
