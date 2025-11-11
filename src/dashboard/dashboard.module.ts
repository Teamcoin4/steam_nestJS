// src/dashboard/dashboard.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { User } from '../domain/users/user.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';
import { Game } from '../domain/games/game.entity';
import { Friend } from '../domain/friends/friends.entity';
import { CacheAsideService } from '../common/cache/cache-aside.service';
import { ApiModule } from '../api/api.module';
import { GameModule } from '../domain/games/game.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, OwnedGame, Game, Friend]),
    forwardRef(() => ApiModule),
    forwardRef(() => GameModule),
  ],
  controllers: [DashboardController],
  providers: [DashboardService, CacheAsideService],
  exports: [DashboardService],
})
export class DashboardModule {}
