import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowManyCashAccounts1794235446240 implements MigrationInterface {
  name = 'AllowManyCashAccounts1794235446240';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_account_company_cash"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_account_company" ON "account" ("companyId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_account_company"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_account_company_cash" ON "account" ("companyId") WHERE ((kind)::text = 'cash'::text)`,
    );
  }
}
