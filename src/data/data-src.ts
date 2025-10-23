// src/data/data-src.ts
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { User } from '../domain/users/user.entity';
import { Game } from '../domain/games/game.entity';
import { OwnedGame } from '../domain/games/owned-game.entity';
// Achievement 경로 조정 (User 엔티티의 Import 경로에 맞춰 추정)
import { Achievement } from '../domain/achievements/achievement.entity';
// User 엔티티 정의에 맞춰 경로 수정
import { UserAchievement } from '../domain/achievements/user-achievement.entity';
// User 엔티티 정의에 맞춰 경로 수정
import { Friend } from '../domain/friends/friends.entity';

// .env 파일 로드
dotenv.config({ path: '.env' });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST!,
  port: parseInt(process.env.DB_PORT!, 10),
  username: process.env.DB_USER!,
  password: process.env.DB_PASS!,
  database: process.env.DB_NAME!,
  // 최종적으로 필요한 모든 엔티티 목록
  entities: [User, Game, OwnedGame, Achievement, UserAchievement, Friend],
  synchronize: false,
  migrations: [__dirname + '/../migration/*{.ts,.js}'],
});
