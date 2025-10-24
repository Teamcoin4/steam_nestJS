import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOneOptions } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async findBySteamId(steamId: string): Promise<User | null> {
    return this.repo.findOne({ where: { steamId } });
  }

  async upsertBySteamId(steamId: string, patch: Partial<User>): Promise<User> {
    const values: Partial<User> = { steamId, ...patch };
    await this.repo.upsert(values, ['steamId']);
    return this.findBySteamId(steamId) as Promise<User>;
  }

  async findById(id: number): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findOne(options: FindOneOptions<User>): Promise<User | null> {
    return this.repo.findOne(options);
  }

  async updateProfile(
    userId: number,
    patch: Partial<Pick<User, 'personaName' | 'avatar'>>,
  ): Promise<void> {
    await this.repo.update({ id: userId }, patch);
  }
}
