import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkerDays1795500000000 implements MigrationInterface {
  name = 'CreateWorkerDays1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Attendance pay is a work entry too: one per daily worker per saved day.
    await queryRunner.query(
      `ALTER TABLE "work_entry" DROP CONSTRAINT "CHK_work_entry_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_entry" ADD CONSTRAINT "CHK_work_entry_source" CHECK ("sourceType" IN ('truck_cut', 'production', 'register', 'attendance'))`,
    );

    await queryRunner.query(
      `CREATE TABLE "attendance_day" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "date" date NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "savedById" uuid NOT NULL, CONSTRAINT "PK_attendance_day" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_attendance_day" ON "attendance_day" ("companyId", "date")`,
    );
    await queryRunner.query(
      `CREATE TABLE "attendance_absence" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "companyId" uuid NOT NULL, "dayId" uuid NOT NULL, "workerId" uuid NOT NULL, CONSTRAINT "PK_attendance_absence" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_attendance_absence" ON "attendance_absence" ("dayId", "workerId")`,
    );

    await queryRunner.query(
      `CREATE TABLE "worker_payment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "paymentSeq" integer NOT NULL, "date" date NOT NULL, "amount" bigint NOT NULL, "note" character varying NOT NULL DEFAULT '', "status" character varying NOT NULL, "reason" character varying, "approvalId" uuid, "ledgerEntryId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "workerId" uuid NOT NULL, "accountId" uuid NOT NULL, "createdById" uuid NOT NULL, "approvedById" uuid, CONSTRAINT "CHK_worker_payment_status" CHECK ("status" IN ('pending', 'confirmed', 'rejected')), CONSTRAINT "CHK_worker_payment_amount" CHECK ("amount" > 0), CONSTRAINT "PK_worker_payment" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_worker_payment_no" ON "worker_payment" ("companyId", "paymentSeq")`,
    );

    for (const [table, column, ref, name] of [
      ['attendance_day', 'companyId', 'company', 'FK_attendance_day_company'],
      [
        'attendance_day',
        'savedById',
        'company_member',
        'FK_attendance_day_saved',
      ],
      [
        'attendance_absence',
        'companyId',
        'company',
        'FK_attendance_absence_company',
      ],
      [
        'attendance_absence',
        'dayId',
        'attendance_day',
        'FK_attendance_absence_day',
      ],
      [
        'attendance_absence',
        'workerId',
        'worker',
        'FK_attendance_absence_worker',
      ],
      ['worker_payment', 'companyId', 'company', 'FK_worker_payment_company'],
      ['worker_payment', 'workerId', 'worker', 'FK_worker_payment_worker'],
      ['worker_payment', 'accountId', 'account', 'FK_worker_payment_account'],
      [
        'worker_payment',
        'createdById',
        'company_member',
        'FK_worker_payment_created',
      ],
      [
        'worker_payment',
        'approvedById',
        'company_member',
        'FK_worker_payment_approved',
      ],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${ref}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "worker_payment"`);
    await queryRunner.query(`DROP TABLE "attendance_absence"`);
    await queryRunner.query(`DROP TABLE "attendance_day"`);
    await queryRunner.query(
      `ALTER TABLE "work_entry" DROP CONSTRAINT "CHK_work_entry_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_entry" ADD CONSTRAINT "CHK_work_entry_source" CHECK ("sourceType" IN ('truck_cut', 'production', 'register'))`,
    );
  }
}
