import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePurchases1794700000000 implements MigrationInterface {
  name = 'CreatePurchases1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The factory's own mark counter: the last mark given, continues forever.
    await queryRunner.query(
      `ALTER TABLE "factory" ADD "markCounter" integer NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(
      `CREATE TABLE "purchase" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "date" date NOT NULL, "material" character varying NOT NULL, "purchiNo" character varying NOT NULL, "truckNo" character varying NOT NULL, "tons" numeric(10,2) NOT NULL, "ratePerTon" numeric(12,2) NOT NULL, "discount" bigint NOT NULL DEFAULT '0', "total" bigint NOT NULL, "stones" integer NOT NULL, "markSeq" integer, "status" character varying NOT NULL, "note" character varying NOT NULL DEFAULT '', "reason" character varying, "approvalId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "supplierId" uuid NOT NULL, "factoryId" uuid NOT NULL, "createdById" uuid NOT NULL, "approvedById" uuid, CONSTRAINT "CHK_purchase_status" CHECK ("status" IN ('pending', 'in_stock', 'cutting', 'cut', 'rejected', 'cancelled')), CONSTRAINT "CHK_purchase_tons" CHECK ("tons" > 0), CONSTRAINT "CHK_purchase_rate" CHECK ("ratePerTon" > 0), CONSTRAINT "CHK_purchase_money" CHECK ("discount" >= 0 AND "total" >= 0), CONSTRAINT "CHK_purchase_stones" CHECK ("stones" BETWEEN 1 AND 20), CONSTRAINT "PK_purchase" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_purchase_purchi" ON "purchase" ("companyId", "supplierId", "purchiNo") WHERE "status" NOT IN ('rejected', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_purchase_mark" ON "purchase" ("factoryId", "markSeq") WHERE "markSeq" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_purchase_company_status" ON "purchase" ("companyId", "status", "date") `,
    );

    for (const [column, table, name] of [
      ['companyId', 'company', 'FK_purchase_company'],
      ['supplierId', 'supplier', 'FK_purchase_supplier'],
      ['factoryId', 'factory', 'FK_purchase_factory'],
      ['createdById', 'company_member', 'FK_purchase_created_by'],
      ['approvedById', 'company_member', 'FK_purchase_approved_by'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "purchase" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${table}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [
      'FK_purchase_approved_by',
      'FK_purchase_created_by',
      'FK_purchase_factory',
      'FK_purchase_supplier',
      'FK_purchase_company',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "purchase" DROP CONSTRAINT "${name}"`,
      );
    }
    await queryRunner.query(
      `DROP INDEX "public"."IDX_purchase_company_status"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_purchase_mark"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_purchase_purchi"`);
    await queryRunner.query(`DROP TABLE "purchase"`);
    await queryRunner.query(`ALTER TABLE "factory" DROP COLUMN "markCounter"`);
  }
}
