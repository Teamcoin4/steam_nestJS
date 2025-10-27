import { Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  // 비동기 반환이므로 async 붙일 필요 없이 Promise 리턴
  findBySteamId(steamId: string): Promise<User | null> {
    return this.repo.findBySteamId(steamId);
  }
}
