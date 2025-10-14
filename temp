import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexes1758785502874 implements MigrationInterface {
  //Postgres의 CREAT INDEX CONCURRENTLY는 트랜잭션 금지
  public transaction = false;

  public async up(q: QueryRunner): Promise<void> {
    // 정렬: playtimeForever -> 보조 정렬 game_id까지 커버
    await q.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_owned_game_user_pf_game ON "owned_game" ("userId", "playtimeForever", "gameId");
        `);

    await q.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_owned_game_user_p2_game ON "owned_game" ("userId", "playtime2Weeks", "gameId");
        `);

    await q.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_lower_name_prefix ON "game" ((LOWER("name")) text_pattern_ops);
        `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP INDEX CONCURRENTLY IF EXISTS idx_game_lower_name_prefix`,
    );
    await q.query(
      `DROP INDEX CONCURRENTLY IF EXISTS idx_owned_game_user_pf_game`,
    );
    await q.query(
      `DROP INDEX CONCURRENTLY IF EXISTS idx_owned_game_user_p2_game`,
    );
  }
}
