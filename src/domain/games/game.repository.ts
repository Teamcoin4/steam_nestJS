// src/domain/games/game.repository.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game } from './game.entity';
import { SteamApiService } from '../../api/steam.api.service';
import { AchievementRepository } from '../achievements/achievement.repository';

@Injectable()
export class GameRepository {
  private readonly logger = new Logger(GameRepository.name);

  constructor(
    @InjectRepository(Game)
    private readonly repo: Repository<Game>,
    private readonly steamApi: SteamApiService,
    private readonly achievementRepo: AchievementRepository,
  ) {}

  /** 🎮 새로운 게임 추가 및 업적 자동 동기화 */
  async upsertGame(game: Partial<Game>): Promise<void> {
    // 1️⃣ Game upsert
    await this.repo.upsert(game, {
      conflictPaths: ['gameId'],
      skipUpdateIfNoValuesChanged: true,
    });

    // 2️⃣ 업적 동기화
    const gameId = game.gameId;
    if (typeof gameId !== 'number') {
      this.logger.warn('Invalid gameId during upsert.');
      return;
    }

    const hasSchema = await this.achievementRepo.exist({ where: { gameId } });
    if (hasSchema) {
      this.logger.log(`Game ${gameId}: achievements already exist.`);
      return;
    }

    const schema = await this.steamApi.getSchemaForGame(gameId);
    const achDefs = Array.isArray(schema?.availableGameStats?.achievements)
      ? schema.availableGameStats.achievements
      : [];

    for (const ach of achDefs) {
      await this.achievementRepo.upsert(
        {
          gameId,
          apiName: ach.name,
          displayName: ach.displayName ?? ach.name,
          description: ach.description,
          hidden: ach.hidden === 1,
          icon: ach.icon,
          iconGray: ach.icongray,
        },
        ['gameId', 'apiName'],
      );
    }

    this.logger.log(
      `Game ${gameId}: Created ${achDefs.length} achievement definitions.`,
    );
  }

  /** 🧩 find 메서드 예시 */
  async findOneById(gameId: number): Promise<Game | null> {
    return this.repo.findOne({ where: { gameId } });
  }

  /** 🧩 전체 목록 조회 */
  async findAll(): Promise<Game[]> {
    return this.repo.find();
  }
}
