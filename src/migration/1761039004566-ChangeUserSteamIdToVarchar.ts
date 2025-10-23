import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class ChangeUserSteamIdToVarchar1761039004566
  implements MigrationInterface
{
  name = 'ChangeUserSteamIdToVarchar1761039004566';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------
    // 1. friends 테이블의 friendId 컬럼 변경 (BIGINT -> VARCHAR)
    // -------------------------------------------------------------

    // 1-1. 기존 외래 키 제약 조건 제거 (자동 생성 쿼리)
    await queryRunner.query(
      `ALTER TABLE "friends" DROP CONSTRAINT "FK_867f9b37dcc79035fa20e8ffe5e"`,
    );

    // 1-2. 임시 VARCHAR 컬럼 추가 (NULL 허용)
    await queryRunner.addColumn(
      'friends',
      new TableColumn({
        name: 'new_friendId',
        type: 'character varying',
        isNullable: true, // 임시 컬럼이므로 NULL 허용
      }),
    );

    // 1-3. 데이터 변환 및 복사 (BIGINT -> VARCHAR)
    // 기존 friendId(BIGINT) 값을 새 컬럼(VARCHAR)으로 형 변환하여 복사
    await queryRunner.query(
      `UPDATE "friends" SET "new_friendId" = CAST("friendId" AS character varying)`,
    );

    // 1-4. 기존 BIGINT 컬럼 삭제
    await queryRunner.query(`ALTER TABLE "friends" DROP COLUMN "friendId"`);

    // 1-5. 임시 컬럼 이름 변경 및 NOT NULL 제약 조건 추가
    await queryRunner.renameColumn('friends', 'new_friendId', 'friendId');
    await queryRunner.query(
      `ALTER TABLE "friends" ALTER COLUMN "friendId" SET NOT NULL`,
    );

    // -------------------------------------------------------------
    // 2. user 테이블의 steamId 컬럼 변경 (BIGINT -> VARCHAR(17))
    // -------------------------------------------------------------

    // 2-1. 기존 인덱스 및 제약 조건 제거 (자동 생성 쿼리)
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1618b9764cfe5f193c45aa3827"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "UQ_1618b9764cfe5f193c45aa38277"`,
    );

    // 2-2. 임시 VARCHAR 컬럼 추가 (NULL 허용)
    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'new_steamId',
        type: 'character varying',
        length: '17',
        isNullable: true, // 임시 컬럼이므로 NULL 허용
        isUnique: true,
      }),
    );

    // 2-3. 데이터 변환 및 복사 (BIGINT -> VARCHAR)
    await queryRunner.query(
      `UPDATE "user" SET "new_steamId" = CAST("steamId" AS character varying)`,
    );

    // 2-4. 기존 BIGINT 컬럼 삭제
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "steamId"`);

    // 2-5. 임시 컬럼 이름 변경 및 NOT NULL 제약 조건 추가
    // 컬럼 이름을 변경하면 UNIQUE 제약 조건 이름도 함께 변경되므로, 아래 복원 쿼리는 제거합니다.
    await queryRunner.renameColumn('user', 'new_steamId', 'steamId');
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "steamId" SET NOT NULL`,
    );

    // 2-6. 제약 조건 및 인덱스 복원 (이전 오류의 원인이 된 중복 쿼리들을 제거합니다.)
    // TypeORM의 renameColumn 쿼리를 통해 제약 조건 UQ_... 가 이미 복원되었으므로,
    // 아래 두 쿼리는 제거하여 중복 오류를 방지합니다.
    /*
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_1618b9764cfe5f193c45aa38277" UNIQUE ("steamId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1618b9764cfe5f193c45aa3827" ON "user" ("steamId") `,
    );
    */

    // 3. friends 테이블에 외래 키 제약 조건 다시 추가 (자동 생성 쿼리)
    await queryRunner.query(
      `ALTER TABLE "friends" ADD CONSTRAINT "FK_867f9b37dcc79035fa20e8ffe5e" FOREIGN KEY ("friendId") REFERENCES "user"("steamId") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // down 로직은 그대로 유지합니다.
    await queryRunner.query(
      `ALTER TABLE "friends" DROP CONSTRAINT "FK_867f9b37dcc79035fa20e8ffe5e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1618b9764cfe5f193c45aa3827"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "UQ_1618b9764cfe5f193c45aa38277"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "steamId"`);
    await queryRunner.query(`ALTER TABLE "user" ADD "steamId" bigint NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_1618b9764cfe5f193c45aa38277" UNIQUE ("steamId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1618b9764cfe5f193c45aa3827" ON "user" ("steamId") `,
    );
    await queryRunner.query(`ALTER TABLE "friends" DROP COLUMN "friendId"`);
    await queryRunner.query(
      `ALTER TABLE "friends" ADD "friendId" bigint NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "friends" ADD CONSTRAINT "FK_867f9b37dcc79035fa20e8ffe5e" FOREIGN KEY ("friendId") REFERENCES "user"("steamId") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
