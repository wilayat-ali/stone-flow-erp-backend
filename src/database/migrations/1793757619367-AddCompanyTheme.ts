import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanyTheme1793757619367 implements MigrationInterface {
  name = 'AddCompanyTheme1793757619367';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company" ADD "theme" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "company" DROP COLUMN "theme"`);
  }
}
