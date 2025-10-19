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
      relations: ['friend'],
      order: { id: 'ASC' },
    });

    return friends.map((f) => ({
      id: f.id,
      userId: f.userId,
      friendId: f.friendId, // number
      friend_since: f.friendSince ? f.friendSince.toISOString() : null,
      created_at: f.createdAt.toISOString(),
      updated_at: f.updatedAt.toISOString(),
    }));
  }

  async countFriends(userId: number): Promise<number> {
    return await this.friendsRepository.count({ where: { userId } });
  }
}
