// src/domain/achievements/achievement.repository.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Achievement } from './achievement.entity';

@Injectable()
export class AchievementRepository extends Repository<Achievement> {
  private readonly logger = new Logger(AchievementRepository.name);

  constructor(
    @InjectRepository(Achievement)
    private readonly baseRepo: Repository<Achievement>,
  ) {
    // Repository 상속을 위한 super() 호출
    super(baseRepo.target, baseRepo.manager, baseRepo.queryRunner);
  }

  /** ✅ 단일 업적 upsert */
  async upsertOne(
    entity: Partial<Achievement>,
    conflictPaths: Array<keyof Achievement> = ['gameId', 'apiName'],
  ): Promise<void> {
    try {
      await this.baseRepo.upsert(entity, {
        conflictPaths,
        skipUpdateIfNoValuesChanged: true,
      });
    } catch (err) {
      this.logger.error(`[AchievementRepo] upsertOne failed: ${String(err)}`);
      throw err;
    }
  }

  /** ✅ 여러 업적 일괄 upsert */
  async upsertMany(
    entities: Partial<Achievement>[],
    conflictPaths: Array<keyof Achievement> = ['gameId', 'apiName'],
  ): Promise<void> {
    if (!Array.isArray(entities) || entities.length === 0) return;

    try {
      await this.baseRepo.upsert(entities, {
        conflictPaths,
        skipUpdateIfNoValuesChanged: true,
      });
    } catch (err) {
      this.logger.error(`[AchievementRepo] upsertMany failed: ${String(err)}`);
      throw err;
    }
  }

  /** ✅ 게임 ID별 업적 조회 */
  async findByGameId(gameId: number): Promise<Achievement[]> {
    return this.baseRepo.find({ where: { gameId } });
  }

  /** ✅ 업적 존재 여부 확인 */
  async existsByGame(gameId: number): Promise<boolean> {
    return this.baseRepo.exist({ where: { gameId } });
  }
}
