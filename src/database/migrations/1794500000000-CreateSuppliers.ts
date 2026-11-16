import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSuppliers1794500000000 implements MigrationInterface {
  name = 'CreateSuppliers1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "supplier" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "type" character varying NOT NULL, "business" character varying NOT NULL DEFAULT '', "phone" character varying NOT NULL, "phoneDigits" character varying NOT NULL, "city" character varying NOT NULL, "cuttingRatePerTon" bigint, "openingBalance" bigint NOT NULL DEFAULT '0', "openingDate" date NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "CHK_supplier_type" CHECK ("type" IN ('mine_owner', 'cutting_factory', 'shop')), CONSTRAINT "CHK_supplier_cutting_rate" CHECK ("cuttingRatePerTon" IS NULL OR "cuttingRatePerTon" > 0), CONSTRAINT "PK_supplier" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_supplier_company_phone" ON "supplier" ("companyId", "phoneDigits") `,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier" ADD CONSTRAINT "FK_supplier_company" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supplier" DROP CONSTRAINT "FK_supplier_company"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_supplier_company_phone"`);
    await queryRunner.query(`DROP TABLE "supplier"`);
  }
}
