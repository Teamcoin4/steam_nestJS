// src/domain/users/user-summary.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSummary } from './user-summary.entity';

@Injectable()
export class UserSummaryRepository {
  constructor(
    @InjectRepository(UserSummary)
    private readonly repo: Repository<UserSummary>,
  ) {}

  async upsertSummary(summary: Partial<UserSummary>): Promise<void> {
    await this.repo.upsert(summary, {
      conflictPaths: ['userId'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  async findByUserId(userId: number): Promise<UserSummary | null> {
    return await this.repo.findOne({ where: { userId } });
  }
}
