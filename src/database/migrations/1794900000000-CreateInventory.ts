import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  DEFAULT_CATALOG,
  DEFAULT_PIECE_SIZES,
  parsePieceSize,
} from '../../settings/default-masters';

export class CreateInventory1794900000000 implements MigrationInterface {
  name = 'CreateInventory1794900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Materials join the plain name lists.
    await queryRunner.query(
      `ALTER TABLE "catalog_item" DROP CONSTRAINT "CHK_catalog_item_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_item" ADD CONSTRAINT "CHK_catalog_item_kind" CHECK ("kind" IN ('soot_size', 'counter_width', 'expense_category', 'material'))`,
    );

    await queryRunner.query(
      `CREATE TABLE "piece_size" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "label" character varying NOT NULL, "widthInches" numeric(8,2) NOT NULL, "lengthInches" numeric(8,2) NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "sootTypeId" uuid NOT NULL, CONSTRAINT "CHK_piece_size_dimensions" CHECK ("widthInches" > 0 AND "lengthInches" > 0), CONSTRAINT "PK_piece_size" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_piece_size_label" ON "piece_size" ("companyId", "sootTypeId", "label") `,
    );

    await queryRunner.query(
      `CREATE TABLE "stock_entry" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "entrySeq" integer NOT NULL, "type" character varying NOT NULL, "date" date NOT NULL, "direction" smallint NOT NULL, "reason" character varying, "note" character varying NOT NULL DEFAULT '', "itemType" character varying NOT NULL, "finish" character varying, "qty" integer NOT NULL, "inches" integer, "status" character varying NOT NULL, "rejectReason" character varying, "approvalId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "factoryId" uuid NOT NULL, "materialId" uuid NOT NULL, "sootTypeId" uuid, "sootSizeId" uuid, "counterWidthId" uuid, "toFactoryId" uuid, "createdById" uuid NOT NULL, "approvedById" uuid, CONSTRAINT "CHK_stock_entry_type" CHECK ("type" IN ('opening', 'adjustment', 'transfer')), CONSTRAINT "CHK_stock_entry_status" CHECK ("status" IN ('pending', 'approved', 'rejected')), CONSTRAINT "CHK_stock_entry_direction" CHECK ("direction" IN (1, -1)), CONSTRAINT "CHK_stock_entry_qty" CHECK ("qty" > 0), CONSTRAINT "CHK_stock_entry_reason" CHECK ("reason" IS NULL OR "reason" IN ('broken', 'mismatch', 'other')), CONSTRAINT "PK_stock_entry" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_entry_no" ON "stock_entry" ("companyId", "entrySeq") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_entry_status" ON "stock_entry" ("companyId", "status", "date") `,
    );

    await queryRunner.query(
      `CREATE TABLE "stock_alert" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "itemKey" character varying NOT NULL, "minQty" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "CHK_stock_alert_min_qty" CHECK ("minQty" > 0), CONSTRAINT "PK_stock_alert" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_alert_item" ON "stock_alert" ("companyId", "itemKey") `,
    );

    for (const [table, column, ref, name] of [
      ['piece_size', 'companyId', 'company', 'FK_piece_size_company'],
      ['piece_size', 'sootTypeId', 'catalog_item', 'FK_piece_size_soot_type'],
      ['stock_entry', 'companyId', 'company', 'FK_stock_entry_company'],
      ['stock_entry', 'factoryId', 'factory', 'FK_stock_entry_factory'],
      ['stock_entry', 'materialId', 'catalog_item', 'FK_stock_entry_material'],
      ['stock_entry', 'sootTypeId', 'catalog_item', 'FK_stock_entry_soot_type'],
      ['stock_entry', 'sootSizeId', 'piece_size', 'FK_stock_entry_soot_size'],
      [
        'stock_entry',
        'counterWidthId',
        'catalog_item',
        'FK_stock_entry_counter_width',
      ],
      ['stock_entry', 'toFactoryId', 'factory', 'FK_stock_entry_to_factory'],
      [
        'stock_entry',
        'createdById',
        'company_member',
        'FK_stock_entry_created_by',
      ],
      [
        'stock_entry',
        'approvedById',
        'company_member',
        'FK_stock_entry_approved_by',
      ],
      ['stock_alert', 'companyId', 'company', 'FK_stock_alert_company'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${ref}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }

    // Companies that already exist get the same materials and piece sizes as new ones.
    const companies = (await queryRunner.query(
      `SELECT "id" FROM "company"`,
    )) as { id: string }[];

    for (const { id } of companies) {
      for (const name of DEFAULT_CATALOG.material) {
        await queryRunner.query(
          `INSERT INTO "catalog_item" ("companyId", "kind", "name", "createdAt") VALUES ($1, 'material', $2, clock_timestamp())`,
          [id, name],
        );
      }

      const soots = (await queryRunner.query(
        `SELECT "id", "name" FROM "catalog_item" WHERE "companyId" = $1 AND "kind" = 'soot_size' ORDER BY "createdAt"`,
        [id],
      )) as { id: string; name: string }[];

      for (const soot of soots) {
        for (const label of DEFAULT_PIECE_SIZES[
          String(parseFloat(soot.name))
        ] ?? []) {
          const size = parsePieceSize(label)!;
          await queryRunner.query(
            `INSERT INTO "piece_size" ("companyId", "sootTypeId", "label", "widthInches", "lengthInches", "createdAt") VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
            [id, soot.id, label, size.widthInches, size.lengthInches],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, name] of [
      ['stock_alert', 'FK_stock_alert_company'],
      ['stock_entry', 'FK_stock_entry_approved_by'],
      ['stock_entry', 'FK_stock_entry_created_by'],
      ['stock_entry', 'FK_stock_entry_to_factory'],
      ['stock_entry', 'FK_stock_entry_counter_width'],
      ['stock_entry', 'FK_stock_entry_soot_size'],
      ['stock_entry', 'FK_stock_entry_soot_type'],
      ['stock_entry', 'FK_stock_entry_material'],
      ['stock_entry', 'FK_stock_entry_factory'],
      ['stock_entry', 'FK_stock_entry_company'],
      ['piece_size', 'FK_piece_size_soot_type'],
      ['piece_size', 'FK_piece_size_company'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`,
      );
    }
    await queryRunner.query(`DROP INDEX "public"."UQ_stock_alert_item"`);
    await queryRunner.query(`DROP TABLE "stock_alert"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_entry_status"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_stock_entry_no"`);
    await queryRunner.query(`DROP TABLE "stock_entry"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_piece_size_label"`);
    await queryRunner.query(`DROP TABLE "piece_size"`);
    await queryRunner.query(
      `DELETE FROM "catalog_item" WHERE "kind" = 'material'`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_item" DROP CONSTRAINT "CHK_catalog_item_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_item" ADD CONSTRAINT "CHK_catalog_item_kind" CHECK ("kind" IN ('soot_size', 'counter_width', 'expense_category'))`,
    );
  }
}
