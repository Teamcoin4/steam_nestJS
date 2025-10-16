import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSteamIdToBigint1760445550334 implements MigrationInterface {
  name = 'UpdateSteamIdToBigint1760445550334';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`TRUNCATE TABLE "friends" CASCADE`);
    await queryRunner.query(`TRUNCATE TABLE "user" CASCADE`);

    await queryRunner.query(
      `ALTER TABLE "friends" DROP CONSTRAINT "UQ_ab7c3ff490dfe9056cd1db1c1e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "friends" DROP CONSTRAINT "FK_867f9b37dcc79035fa20e8ffe5e"`,
    );
    await queryRunner.query(`ALTER TABLE "friends" DROP COLUMN "friendId"`);
    await queryRunner.query(
      `ALTER TABLE "friends" ADD "friendId" bigint NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "friends" DROP COLUMN "friend_since"`);
    await queryRunner.query(
      `ALTER TABLE "friends" ADD "friend_since" TIMESTAMP`,
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
    await queryRunner.query(
      `ALTER TABLE "friends" ADD CONSTRAINT "FK_867f9b37dcc79035fa20e8ffe5e" FOREIGN KEY ("friendId") REFERENCES "user"("steamId") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(
      `ALTER TABLE "user" ADD "steamId" character varying(17) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_1618b9764cfe5f193c45aa38277" UNIQUE ("steamId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1618b9764cfe5f193c45aa3827" ON "user" ("steamId") `,
    );
    await queryRunner.query(`ALTER TABLE "friends" DROP COLUMN "friend_since"`);
    await queryRunner.query(
      `ALTER TABLE "friends" ADD "friend_since" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "friends" DROP COLUMN "friendId"`);
    await queryRunner.query(
      `ALTER TABLE "friends" ADD "friendId" integer NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "friends" ADD CONSTRAINT "FK_867f9b37dcc79035fa20e8ffe5e" FOREIGN KEY ("friendId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "friends" ADD CONSTRAINT "UQ_ab7c3ff490dfe9056cd1db1c1e3" UNIQUE ("userId", "friendId")`,
    );
  }
}
