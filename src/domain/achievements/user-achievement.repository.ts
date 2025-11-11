// src/domain/achievements/user-achievement.repository.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAchievement } from './user-achievement.entity';

@Injectable()
export class UserAchievementRepository extends Repository<UserAchievement> {
  private readonly logger = new Logger(UserAchievementRepository.name);

  constructor(
    @InjectRepository(UserAchievement)
    private readonly baseRepo: Repository<UserAchievement>,
  ) {
    super(baseRepo.target, baseRepo.manager, baseRepo.queryRunner);
  }

  /** 🎯 단일 업적 upsert */
  async upsertOne(
    entity: Partial<UserAchievement>,
    conflictPaths: Array<keyof UserAchievement> = [
      'userId',
      'gameId',
      'apiName',
    ],
  ): Promise<void> {
    await this.baseRepo.upsert(entity, {
      conflictPaths,
      skipUpdateIfNoValuesChanged: true,
    });
    this.logger.debug(
      `[upsertOne] ${entity.userId}:${entity.gameId}:${entity.apiName}`,
    );
  }

  /** 🎯 다중 업적 upsert */
  async upsertMany(rows: Partial<UserAchievement>[]): Promise<void> {
    if (rows.length === 0) return;
    await this.baseRepo.upsert(rows, {
      conflictPaths: ['userId', 'gameId', 'apiName'],
      skipUpdateIfNoValuesChanged: true,
    });
    this.logger.debug(`[upsertMany] inserted ${rows.length} records`);
  }

  /** 🎯 특정 유저/게임 조합 존재 여부 */
  async exists(params: {
    where: { userId: number; gameId: number };
  }): Promise<boolean> {
    return this.baseRepo.exists(params);
  }

  /** 🎯 특정 유저의 특정 게임 업적들 조회 */
  async findByUserAndGame(
    userId: number,
    gameId: number,
  ): Promise<UserAchievement[]> {
    return this.baseRepo.find({ where: { userId, gameId } });
  }

  /** 🎯 특정 유저의 달성/전체 업적 수 계산 */
  async countByUser(userId: number): Promise<[earned: number, total: number]> {
    const [earned, total] = await Promise.all([
      this.baseRepo.count({ where: { userId, achieved: true } }),
      this.baseRepo.count({ where: { userId } }),
    ]);
    return [earned, total];
  }
}
