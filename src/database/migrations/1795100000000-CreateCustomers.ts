import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomers1795100000000 implements MigrationInterface {
  name = 'CreateCustomers1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "customer" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "type" character varying NOT NULL, "phone" character varying NOT NULL, "phoneDigits" character varying NOT NULL, "city" character varying NOT NULL DEFAULT '', "contactPerson" character varying NOT NULL DEFAULT '', "openingBalance" bigint NOT NULL DEFAULT 0, "openingDate" date NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "CHK_customer_type" CHECK ("type" IN ('builder', 'dealer', 'cutting')), CONSTRAINT "PK_customer" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_customer_company_phone" ON "customer" ("companyId", "phoneDigits")`,
    );

    await queryRunner.query(
      `CREATE TABLE "cutting_job" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "jobSeq" integer NOT NULL, "date" date NOT NULL, "truckNo" character varying NOT NULL, "material" character varying NOT NULL, "tons" numeric(10,2) NOT NULL, "ratePerSqft" numeric(12,2) NOT NULL, "status" character varying NOT NULL, "cutStart" date, "sqft" numeric(12,2), "outputNote" character varying NOT NULL DEFAULT '', "readyOn" date, "deliveredOn" date, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "customerId" uuid NOT NULL, "factoryId" uuid NOT NULL, "machineId" uuid, "thekadarId" uuid, "createdById" uuid NOT NULL, CONSTRAINT "CHK_cutting_job_status" CHECK ("status" IN ('received', 'cutting', 'ready', 'delivered', 'cancelled')), CONSTRAINT "CHK_cutting_job_tons" CHECK ("tons" > 0), CONSTRAINT "CHK_cutting_job_rate" CHECK ("ratePerSqft" > 0), CONSTRAINT "PK_cutting_job" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_cutting_job_no" ON "cutting_job" ("companyId", "jobSeq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cutting_job_status" ON "cutting_job" ("companyId", "status", "date")`,
    );

    for (const [table, column, ref, name] of [
      ['customer', 'companyId', 'company', 'FK_customer_company'],
      ['cutting_job', 'companyId', 'company', 'FK_cutting_job_company'],
      ['cutting_job', 'customerId', 'customer', 'FK_cutting_job_customer'],
      ['cutting_job', 'factoryId', 'factory', 'FK_cutting_job_factory'],
      ['cutting_job', 'machineId', 'machine', 'FK_cutting_job_machine'],
      ['cutting_job', 'thekadarId', 'worker', 'FK_cutting_job_thekadar'],
      [
        'cutting_job',
        'createdById',
        'company_member',
        'FK_cutting_job_created',
      ],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${ref}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cutting_job"`);
    await queryRunner.query(`DROP TABLE "customer"`);
  }
}
