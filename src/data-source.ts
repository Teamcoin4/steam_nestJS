import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config({ path: '.env' });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || 'app',
  entities: ['src/domain/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  synchronize: true,
  logging: true,
  migrationsTransactionMode: 'each', // 이 줄 추가 - 각 마이그레이션이 자신의 transaction 설정 사용
});
