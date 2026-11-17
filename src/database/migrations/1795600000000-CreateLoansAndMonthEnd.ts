import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoansAndMonthEnd1795600000000 implements MigrationInterface {
  name = 'CreateLoansAndMonthEnd1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "loan" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "loanSeq" integer NOT NULL, "date" date NOT NULL, "amount" bigint NOT NULL, "monthlyInstalment" bigint NOT NULL, "firstMonth" character varying(7) NOT NULL, "priorRepaid" bigint NOT NULL DEFAULT 0, "reason" character varying NOT NULL DEFAULT '', "ledgerEntryId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "workerId" uuid NOT NULL, "accountId" uuid, "createdById" uuid NOT NULL, CONSTRAINT "CHK_loan_amount" CHECK ("amount" > 0), CONSTRAINT "CHK_loan_instalment" CHECK ("monthlyInstalment" > 0), CONSTRAINT "CHK_loan_prior" CHECK ("priorRepaid" >= 0 AND "priorRepaid" < "amount"), CONSTRAINT "PK_loan" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_loan_no" ON "loan" ("companyId", "loanSeq")`,
    );

    // The owner's change for one month before it closes: another amount, or skipped.
    await queryRunner.query(
      `CREATE TABLE "loan_override" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "month" character varying(7) NOT NULL, "amount" bigint, "skip" boolean NOT NULL DEFAULT false, "companyId" uuid NOT NULL, "loanId" uuid NOT NULL, CONSTRAINT "CHK_loan_override" CHECK ("skip" OR "amount" > 0), CONSTRAINT "PK_loan_override" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_loan_override" ON "loan_override" ("loanId", "month")`,
    );

    // A month is closed by one row; reopening stamps it and a new close may follow.
    await queryRunner.query(
      `CREATE TABLE "month_close" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "month" character varying(7) NOT NULL, "salaries" bigint NOT NULL DEFAULT 0, "instalments" bigint NOT NULL DEFAULT 0, "closedAt" TIMESTAMP NOT NULL DEFAULT now(), "reopenedAt" TIMESTAMP, "companyId" uuid NOT NULL, "closedById" uuid NOT NULL, "reopenedById" uuid, CONSTRAINT "PK_month_close" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_month_close_open" ON "month_close" ("companyId", "month") WHERE "reopenedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "month_close_posting" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "salary" bigint NOT NULL DEFAULT 0, "absentDays" integer NOT NULL DEFAULT 0, "cut" bigint NOT NULL DEFAULT 0, "net" bigint NOT NULL DEFAULT 0, "companyId" uuid NOT NULL, "closeId" uuid NOT NULL, "workerId" uuid NOT NULL, CONSTRAINT "PK_month_close_posting" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "month_close_instalment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "amount" bigint NOT NULL DEFAULT 0, "skipped" boolean NOT NULL DEFAULT false, "companyId" uuid NOT NULL, "postingId" uuid NOT NULL, "loanId" uuid NOT NULL, CONSTRAINT "PK_month_close_instalment" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "month_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "month" character varying(7) NOT NULL, "action" character varying NOT NULL, "at" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "byId" uuid NOT NULL, CONSTRAINT "CHK_month_log_action" CHECK ("action" IN ('closed', 'reopened')), CONSTRAINT "PK_month_log" PRIMARY KEY ("id"))`,
    );

    for (const [table, column, ref, name] of [
      ['loan', 'companyId', 'company', 'FK_loan_company'],
      ['loan', 'workerId', 'worker', 'FK_loan_worker'],
      ['loan', 'accountId', 'account', 'FK_loan_account'],
      ['loan', 'createdById', 'company_member', 'FK_loan_created'],
      ['loan_override', 'companyId', 'company', 'FK_loan_override_company'],
      ['loan_override', 'loanId', 'loan', 'FK_loan_override_loan'],
      ['month_close', 'companyId', 'company', 'FK_month_close_company'],
      ['month_close', 'closedById', 'company_member', 'FK_month_close_closed'],
      [
        'month_close',
        'reopenedById',
        'company_member',
        'FK_month_close_reopened',
      ],
      [
        'month_close_posting',
        'companyId',
        'company',
        'FK_month_close_posting_company',
      ],
      [
        'month_close_posting',
        'closeId',
        'month_close',
        'FK_month_close_posting_close',
      ],
      [
        'month_close_posting',
        'workerId',
        'worker',
        'FK_month_close_posting_worker',
      ],
      [
        'month_close_instalment',
        'companyId',
        'company',
        'FK_month_close_instalment_company',
      ],
      [
        'month_close_instalment',
        'postingId',
        'month_close_posting',
        'FK_month_close_instalment_posting',
      ],
      [
        'month_close_instalment',
        'loanId',
        'loan',
        'FK_month_close_instalment_loan',
      ],
      ['month_log', 'companyId', 'company', 'FK_month_log_company'],
      ['month_log', 'byId', 'company_member', 'FK_month_log_by'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${ref}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'month_log',
      'month_close_instalment',
      'month_close_posting',
      'month_close',
      'loan_override',
      'loan',
    ]) {
      await queryRunner.query(`DROP TABLE "${table}"`);
    }
  }
}
