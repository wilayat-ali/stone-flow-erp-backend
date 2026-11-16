import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  DEFAULT_CATALOG,
  DEFAULT_WORKER_RATES,
} from '../../settings/default-masters';

export class CreateSettingsMasters1794600000000 implements MigrationInterface {
  name = 'CreateSettingsMasters1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "factory" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "kind" character varying NOT NULL, "ratePerTon" numeric(12,2), "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "CHK_factory_kind" CHECK ("kind" IN ('own', 'cutting')), CONSTRAINT "CHK_factory_rate" CHECK ("ratePerTon" IS NULL OR "ratePerTon" > 0), CONSTRAINT "PK_factory" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_factory_company" ON "factory" ("companyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "machine" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "type" character varying NOT NULL, "dayThekadar" character varying NOT NULL, "nightThekadar" character varying, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "factoryId" uuid NOT NULL, CONSTRAINT "CHK_machine_type" CHECK ("type" IN ('vertical', 'gangSaw', 'monolama', 'blockCutter')), CONSTRAINT "PK_machine" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_machine_company" ON "machine" ("companyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "catalog_item" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "kind" character varying NOT NULL, "name" character varying NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "CHK_catalog_item_kind" CHECK ("kind" IN ('soot_size', 'counter_width', 'expense_category')), CONSTRAINT "PK_catalog_item" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_catalog_item_company_kind" ON "catalog_item" ("companyId", "kind") `,
    );
    await queryRunner.query(
      `CREATE TABLE "worker_rate" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "payType" character varying NOT NULL, "rate" numeric(12,2) NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "CHK_worker_rate_pay_type" CHECK ("payType" IN ('perTon', 'perSqft', 'daily', 'monthly')), CONSTRAINT "CHK_worker_rate_rate" CHECK ("rate" > 0), CONSTRAINT "PK_worker_rate" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_rate_company" ON "worker_rate" ("companyId") `,
    );

    for (const table of [
      ['factory', 'FK_factory_company'],
      ['machine', 'FK_machine_company'],
      ['catalog_item', 'FK_catalog_item_company'],
      ['worker_rate', 'FK_worker_rate_company'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table[0]}" ADD CONSTRAINT "${table[1]}" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "machine" ADD CONSTRAINT "FK_machine_factory" FOREIGN KEY ("factoryId") REFERENCES "factory"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // Companies that already exist get the same starting lists as new ones.
    const companies = (await queryRunner.query(
      `SELECT "id" FROM "company"`,
    )) as { id: string }[];

    for (const { id } of companies) {
      for (const [kind, names] of Object.entries(DEFAULT_CATALOG)) {
        for (const name of names) {
          await queryRunner.query(
            `INSERT INTO "catalog_item" ("companyId", "kind", "name", "createdAt") VALUES ($1, $2, $3, clock_timestamp())`,
            [id, kind, name],
          );
        }
      }
      for (const rate of DEFAULT_WORKER_RATES) {
        await queryRunner.query(
          `INSERT INTO "worker_rate" ("companyId", "name", "payType", "rate", "createdAt") VALUES ($1, $2, $3, $4, clock_timestamp())`,
          [id, rate.name, rate.payType, rate.rate],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "machine" DROP CONSTRAINT "FK_machine_factory"`,
    );
    for (const table of [
      ['worker_rate', 'FK_worker_rate_company'],
      ['catalog_item', 'FK_catalog_item_company'],
      ['machine', 'FK_machine_company'],
      ['factory', 'FK_factory_company'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table[0]}" DROP CONSTRAINT "${table[1]}"`,
      );
    }
    await queryRunner.query(`DROP INDEX "public"."IDX_worker_rate_company"`);
    await queryRunner.query(`DROP TABLE "worker_rate"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_catalog_item_company_kind"`,
    );
    await queryRunner.query(`DROP TABLE "catalog_item"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_machine_company"`);
    await queryRunner.query(`DROP TABLE "machine"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_factory_company"`);
    await queryRunner.query(`DROP TABLE "factory"`);
  }
}
