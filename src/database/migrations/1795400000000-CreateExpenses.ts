import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExpenses1795400000000 implements MigrationInterface {
  name = 'CreateExpenses1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "expense" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "expenseSeq" integer NOT NULL, "date" date NOT NULL, "description" character varying NOT NULL, "amount" bigint NOT NULL, "payMode" character varying NOT NULL, "dueDate" date, "paidOn" date, "photoName" character varying, "status" character varying NOT NULL, "reason" character varying, "approvalId" uuid, "ledgerEntryId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "categoryId" uuid NOT NULL, "factoryId" uuid NOT NULL, "accountId" uuid, "shopId" uuid, "createdById" uuid NOT NULL, "approvedById" uuid, CONSTRAINT "CHK_expense_pay_mode" CHECK ("payMode" IN ('paid', 'unpaid', 'shop_credit')), CONSTRAINT "CHK_expense_status" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled')), CONSTRAINT "CHK_expense_amount" CHECK ("amount" > 0), CONSTRAINT "PK_expense" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_expense_no" ON "expense" ("companyId", "expenseSeq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_expense_date" ON "expense" ("companyId", "date")`,
    );

    await queryRunner.query(
      `CREATE TABLE "munshi_give" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "date" date NOT NULL, "amount" bigint NOT NULL, "note" character varying NOT NULL DEFAULT '', "transferId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "fromAccountId" uuid NOT NULL, "createdById" uuid NOT NULL, CONSTRAINT "CHK_munshi_give_amount" CHECK ("amount" > 0), CONSTRAINT "PK_munshi_give" PRIMARY KEY ("id"))`,
    );

    for (const [table, column, ref, name] of [
      ['expense', 'companyId', 'company', 'FK_expense_company'],
      ['expense', 'categoryId', 'catalog_item', 'FK_expense_category'],
      ['expense', 'factoryId', 'factory', 'FK_expense_factory'],
      ['expense', 'accountId', 'account', 'FK_expense_account'],
      ['expense', 'shopId', 'supplier', 'FK_expense_shop'],
      ['expense', 'createdById', 'company_member', 'FK_expense_created'],
      ['expense', 'approvedById', 'company_member', 'FK_expense_approved'],
      ['munshi_give', 'companyId', 'company', 'FK_munshi_give_company'],
      ['munshi_give', 'fromAccountId', 'account', 'FK_munshi_give_from'],
      [
        'munshi_give',
        'createdById',
        'company_member',
        'FK_munshi_give_created',
      ],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${ref}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "munshi_give"`);
    await queryRunner.query(`DROP TABLE "expense"`);
  }
}
