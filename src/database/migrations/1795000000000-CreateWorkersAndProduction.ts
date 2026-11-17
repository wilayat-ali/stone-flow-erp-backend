import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkersAndProduction1795000000000 implements MigrationInterface {
  name = 'CreateWorkersAndProduction1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "worker" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "phone" character varying NOT NULL DEFAULT '', "jobTitle" character varying NOT NULL DEFAULT '', "payType" character varying NOT NULL, "rate" numeric(12,2) NOT NULL DEFAULT 0, "defaultJob" character varying NOT NULL DEFAULT '', "openingBalance" bigint NOT NULL DEFAULT 0, "joinedOn" date NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "factoryId" uuid NOT NULL, CONSTRAINT "CHK_worker_pay_type" CHECK ("payType" IN ('ton', 'sqft', 'day', 'month')), CONSTRAINT "CHK_worker_rate" CHECK ("rate" >= 0), CONSTRAINT "PK_worker" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_worker_name" ON "worker" ("companyId", lower("name"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "work_entry" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "date" date NOT NULL, "job" character varying NOT NULL, "unit" character varying NOT NULL, "qty" numeric(12,2) NOT NULL, "rate" numeric(12,2) NOT NULL, "amount" bigint NOT NULL, "sourceType" character varying NOT NULL, "sourceId" character varying NOT NULL, "auto" boolean NOT NULL DEFAULT false, "reversedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "workerId" uuid NOT NULL, "createdById" uuid NOT NULL, CONSTRAINT "CHK_work_entry_unit" CHECK ("unit" IN ('ton', 'sqft', 'day')), CONSTRAINT "CHK_work_entry_source" CHECK ("sourceType" IN ('truck_cut', 'production', 'register')), CONSTRAINT "CHK_work_entry_amount" CHECK ("amount" >= 0), CONSTRAINT "PK_work_entry" PRIMARY KEY ("id"))`,
    );
    // One live entry per step: asking twice cannot pay a worker twice.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_work_entry_source" ON "work_entry" ("companyId", "sourceType", "sourceId") WHERE "reversedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_work_entry_worker" ON "work_entry" ("companyId", "workerId", "date")`,
    );

    await queryRunner.query(
      `CREATE TABLE "production_entry" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "entrySeq" integer NOT NULL, "date" date NOT NULL, "type" character varying NOT NULL, "machineType" character varying, "workerRate" numeric(12,2) NOT NULL DEFAULT 0, "workerAmount" bigint NOT NULL DEFAULT 0, "wasteSqft" numeric(12,2) NOT NULL DEFAULT 0, "note" character varying NOT NULL DEFAULT '', "status" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "factoryId" uuid NOT NULL, "materialId" uuid NOT NULL, "purchaseId" uuid, "workerId" uuid, "createdById" uuid NOT NULL, "reversedById" uuid, CONSTRAINT "CHK_production_entry_type" CHECK ("type" IN ('cut', 'section', 'counter', 'resize', 'polish')), CONSTRAINT "CHK_production_entry_status" CHECK ("status" IN ('posted', 'reversed')), CONSTRAINT "PK_production_entry" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_production_entry_no" ON "production_entry" ("companyId", "entrySeq")`,
    );
    // A truck's output is counted once.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_production_entry_cut" ON "production_entry" ("companyId", "purchaseId") WHERE "type" = 'cut' AND "status" = 'posted'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_production_entry_date" ON "production_entry" ("companyId", "date")`,
    );

    await queryRunner.query(
      `CREATE TABLE "production_entry_line" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "direction" character varying NOT NULL, "itemType" character varying NOT NULL, "finish" character varying, "qty" integer NOT NULL, "inches" integer, "lineNo" smallint NOT NULL, "companyId" uuid NOT NULL, "entryId" uuid NOT NULL, "factoryId" uuid NOT NULL, "materialId" uuid NOT NULL, "sootTypeId" uuid, "sootSizeId" uuid, "counterWidthId" uuid, CONSTRAINT "CHK_production_line_direction" CHECK ("direction" IN ('in', 'out')), CONSTRAINT "CHK_production_line_qty" CHECK ("qty" > 0), CONSTRAINT "PK_production_entry_line" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_production_line_entry" ON "production_entry_line" ("entryId", "lineNo")`,
    );

    // What Production adds to a truck: the machine and thekadar it was sent
    // to, and when cutting started and ended.
    await queryRunner.query(
      `ALTER TABLE "purchase" ADD "machineId" uuid, ADD "thekadarId" uuid, ADD "cutStart" date, ADD "cutEnd" date, ADD "cutRatePerTon" numeric(12,2)`,
    );

    for (const [table, column, ref, name] of [
      ['worker', 'companyId', 'company', 'FK_worker_company'],
      ['worker', 'factoryId', 'factory', 'FK_worker_factory'],
      ['work_entry', 'companyId', 'company', 'FK_work_entry_company'],
      ['work_entry', 'workerId', 'worker', 'FK_work_entry_worker'],
      ['work_entry', 'createdById', 'company_member', 'FK_work_entry_created'],
      ['production_entry', 'companyId', 'company', 'FK_production_company'],
      ['production_entry', 'factoryId', 'factory', 'FK_production_factory'],
      [
        'production_entry',
        'materialId',
        'catalog_item',
        'FK_production_material',
      ],
      ['production_entry', 'purchaseId', 'purchase', 'FK_production_purchase'],
      ['production_entry', 'workerId', 'worker', 'FK_production_worker'],
      [
        'production_entry',
        'createdById',
        'company_member',
        'FK_production_created',
      ],
      [
        'production_entry',
        'reversedById',
        'company_member',
        'FK_production_reversed',
      ],
      [
        'production_entry_line',
        'companyId',
        'company',
        'FK_production_line_company',
      ],
      [
        'production_entry_line',
        'entryId',
        'production_entry',
        'FK_production_line_entry',
      ],
      [
        'production_entry_line',
        'factoryId',
        'factory',
        'FK_production_line_factory',
      ],
      [
        'production_entry_line',
        'materialId',
        'catalog_item',
        'FK_production_line_material',
      ],
      [
        'production_entry_line',
        'sootTypeId',
        'catalog_item',
        'FK_production_line_soot',
      ],
      [
        'production_entry_line',
        'sootSizeId',
        'piece_size',
        'FK_production_line_size',
      ],
      [
        'production_entry_line',
        'counterWidthId',
        'catalog_item',
        'FK_production_line_width',
      ],
      ['purchase', 'machineId', 'machine', 'FK_purchase_machine'],
      ['purchase', 'thekadarId', 'worker', 'FK_purchase_thekadar'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${ref}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "purchase" DROP CONSTRAINT "FK_purchase_thekadar"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase" DROP CONSTRAINT "FK_purchase_machine"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase" DROP COLUMN "machineId", DROP COLUMN "thekadarId", DROP COLUMN "cutStart", DROP COLUMN "cutEnd", DROP COLUMN "cutRatePerTon"`,
    );
    await queryRunner.query(`DROP TABLE "production_entry_line"`);
    await queryRunner.query(`DROP TABLE "production_entry"`);
    await queryRunner.query(`DROP TABLE "work_entry"`);
    await queryRunner.query(`DROP TABLE "worker"`);
  }
}
