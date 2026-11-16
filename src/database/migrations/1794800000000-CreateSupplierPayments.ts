import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupplierPayments1794800000000 implements MigrationInterface {
  name = 'CreateSupplierPayments1794800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "supplier_payment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "voucherSeq" integer NOT NULL, "date" date NOT NULL, "method" character varying NOT NULL, "amount" bigint NOT NULL, "reference" character varying NOT NULL DEFAULT '', "forPurchaseIds" uuid array NOT NULL DEFAULT '{}', "status" character varying NOT NULL, "note" character varying NOT NULL DEFAULT '', "approvalId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "supplierId" uuid NOT NULL, "accountId" uuid NOT NULL, "createdById" uuid NOT NULL, "approvedById" uuid, CONSTRAINT "CHK_supplier_payment_method" CHECK ("method" IN ('cash', 'bank_transfer', 'cheque')), CONSTRAINT "CHK_supplier_payment_status" CHECK ("status" IN ('pending', 'confirmed', 'reversed')), CONSTRAINT "CHK_supplier_payment_amount" CHECK ("amount" > 0), CONSTRAINT "PK_supplier_payment" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_supplier_payment_voucher" ON "supplier_payment" ("companyId", "voucherSeq") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_supplier_payment_supplier" ON "supplier_payment" ("companyId", "supplierId", "date") `,
    );

    await queryRunner.query(
      `CREATE TABLE "supplier_cheque" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "no" character varying NOT NULL, "amount" bigint NOT NULL, "issuedOn" date NOT NULL, "chequeDate" date NOT NULL, "status" character varying NOT NULL, "statusDate" date, "reason" character varying, "charge" bigint NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "accountId" uuid NOT NULL, "supplierId" uuid NOT NULL, "paymentId" uuid NOT NULL, "replacedByPaymentId" uuid, CONSTRAINT "CHK_supplier_cheque_status" CHECK ("status" IN ('issued', 'cleared', 'bounced', 'cancelled')), CONSTRAINT "CHK_supplier_cheque_amount" CHECK ("amount" > 0 AND "charge" >= 0), CONSTRAINT "PK_supplier_cheque" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_supplier_cheque_no" ON "supplier_cheque" ("companyId", "accountId", "no") WHERE "status" <> 'cancelled'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_supplier_cheque_supplier" ON "supplier_cheque" ("companyId", "supplierId", "status") `,
    );

    for (const [table, column, ref, name] of [
      [
        'supplier_payment',
        'companyId',
        'company',
        'FK_supplier_payment_company',
      ],
      [
        'supplier_payment',
        'supplierId',
        'supplier',
        'FK_supplier_payment_supplier',
      ],
      [
        'supplier_payment',
        'accountId',
        'account',
        'FK_supplier_payment_account',
      ],
      [
        'supplier_payment',
        'createdById',
        'company_member',
        'FK_supplier_payment_created_by',
      ],
      [
        'supplier_payment',
        'approvedById',
        'company_member',
        'FK_supplier_payment_approved_by',
      ],
      ['supplier_cheque', 'companyId', 'company', 'FK_supplier_cheque_company'],
      ['supplier_cheque', 'accountId', 'account', 'FK_supplier_cheque_account'],
      [
        'supplier_cheque',
        'supplierId',
        'supplier',
        'FK_supplier_cheque_supplier',
      ],
      [
        'supplier_cheque',
        'paymentId',
        'supplier_payment',
        'FK_supplier_cheque_payment',
      ],
      [
        'supplier_cheque',
        'replacedByPaymentId',
        'supplier_payment',
        'FK_supplier_cheque_replaced_by',
      ],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${ref}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, name] of [
      ['supplier_cheque', 'FK_supplier_cheque_replaced_by'],
      ['supplier_cheque', 'FK_supplier_cheque_payment'],
      ['supplier_cheque', 'FK_supplier_cheque_supplier'],
      ['supplier_cheque', 'FK_supplier_cheque_account'],
      ['supplier_cheque', 'FK_supplier_cheque_company'],
      ['supplier_payment', 'FK_supplier_payment_approved_by'],
      ['supplier_payment', 'FK_supplier_payment_created_by'],
      ['supplier_payment', 'FK_supplier_payment_account'],
      ['supplier_payment', 'FK_supplier_payment_supplier'],
      ['supplier_payment', 'FK_supplier_payment_company'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`,
      );
    }
    await queryRunner.query(
      `DROP INDEX "public"."IDX_supplier_cheque_supplier"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_supplier_cheque_no"`);
    await queryRunner.query(`DROP TABLE "supplier_cheque"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_supplier_payment_supplier"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_supplier_payment_voucher"`,
    );
    await queryRunner.query(`DROP TABLE "supplier_payment"`);
  }
}
