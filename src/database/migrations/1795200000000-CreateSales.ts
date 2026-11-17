import { MigrationInterface, QueryRunner } from 'typeorm';

// The columns that name one kind of stone, shared by bill and order lines.
const ITEM = `"itemType" character varying NOT NULL, "finish" character varying, "materialId" uuid NOT NULL, "sootTypeId" uuid, "sootSizeId" uuid, "counterWidthId" uuid`;

export class CreateSales1795200000000 implements MigrationInterface {
  name = 'CreateSales1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sales_order" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderSeq" integer NOT NULL, "date" date NOT NULL, "neededBy" date NOT NULL, "cancelled" boolean NOT NULL DEFAULT false, "note" character varying NOT NULL DEFAULT '', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "customerId" uuid NOT NULL, "factoryId" uuid NOT NULL, "createdById" uuid NOT NULL, CONSTRAINT "PK_sales_order" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sales_order_no" ON "sales_order" ("companyId", "orderSeq")`,
    );
    await queryRunner.query(
      `CREATE TABLE "order_line" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lineNo" smallint NOT NULL, ${ITEM}, "qty" integer NOT NULL, "inches" integer, "tons" numeric(10,2) NOT NULL DEFAULT 0, "rate" numeric(12,2) NOT NULL, "companyId" uuid NOT NULL, "orderId" uuid NOT NULL, CONSTRAINT "CHK_order_line_qty" CHECK ("qty" > 0), CONSTRAINT "PK_order_line" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "bill" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "billSeq" integer NOT NULL, "date" date NOT NULL, "walkinName" character varying NOT NULL DEFAULT '', "walkinPhone" character varying NOT NULL DEFAULT '', "discount" bigint NOT NULL DEFAULT 0, "transport" bigint NOT NULL DEFAULT 0, "total" bigint NOT NULL, "status" character varying NOT NULL, "note" character varying NOT NULL DEFAULT '', "cancelReason" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "customerId" uuid, "factoryId" uuid NOT NULL, "orderId" uuid, "createdById" uuid NOT NULL, CONSTRAINT "CHK_bill_status" CHECK ("status" IN ('active', 'cancelled')), CONSTRAINT "CHK_bill_total" CHECK ("total" > 0), CONSTRAINT "PK_bill" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bill_no" ON "bill" ("companyId", "billSeq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bill_customer" ON "bill" ("companyId", "customerId", "date")`,
    );
    await queryRunner.query(
      `CREATE TABLE "bill_line" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lineNo" smallint NOT NULL, ${ITEM}, "qty" integer NOT NULL, "inches" integer, "tons" numeric(10,2) NOT NULL DEFAULT 0, "rate" numeric(12,2) NOT NULL, "companyId" uuid NOT NULL, "billId" uuid NOT NULL, "orderLineId" uuid, CONSTRAINT "CHK_bill_line_qty" CHECK ("qty" > 0), CONSTRAINT "PK_bill_line" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bill_line_bill" ON "bill_line" ("billId", "lineNo")`,
    );
    await queryRunner.query(
      `CREATE TABLE "bill_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "date" date NOT NULL, "text" character varying NOT NULL, "byName" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT clock_timestamp(), "companyId" uuid NOT NULL, "billId" uuid NOT NULL, CONSTRAINT "PK_bill_log" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "bill_collection" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "collSeq" integer NOT NULL, "date" date NOT NULL, "vehicle" character varying NOT NULL DEFAULT '', "receivedBy" character varying NOT NULL DEFAULT '', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "billId" uuid NOT NULL, "createdById" uuid NOT NULL, CONSTRAINT "PK_bill_collection" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bill_collection_no" ON "bill_collection" ("companyId", "collSeq")`,
    );
    await queryRunner.query(
      `CREATE TABLE "collection_line" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lineNo" smallint NOT NULL, "qty" integer NOT NULL, "inches" integer NOT NULL DEFAULT 0, "companyId" uuid NOT NULL, "collectionId" uuid NOT NULL, CONSTRAINT "PK_collection_line" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "customer_payment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "receiptSeq" integer NOT NULL, "date" date NOT NULL, "walkinName" character varying NOT NULL DEFAULT '', "amount" bigint NOT NULL, "method" character varying NOT NULL, "note" character varying NOT NULL DEFAULT '', "status" character varying NOT NULL, "ledgerEntryId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "customerId" uuid, "accountId" uuid, "billId" uuid, "orderId" uuid, "createdById" uuid NOT NULL, CONSTRAINT "CHK_customer_payment_method" CHECK ("method" IN ('cash', 'bank', 'cheque')), CONSTRAINT "CHK_customer_payment_status" CHECK ("status" IN ('posted', 'reversed')), CONSTRAINT "CHK_customer_payment_amount" CHECK ("amount" > 0), CONSTRAINT "PK_customer_payment" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_customer_payment_no" ON "customer_payment" ("companyId", "receiptSeq")`,
    );
    await queryRunner.query(
      `CREATE TABLE "customer_cheque" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "bankName" character varying NOT NULL, "chequeNo" character varying NOT NULL, "chequeDate" date NOT NULL, "receivedOn" date NOT NULL, "amount" bigint NOT NULL, "status" character varying NOT NULL, "clearedOn" date, "bouncedOn" date, "bounceReason" character varying, "clearEntryId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, "paymentId" uuid NOT NULL, "customerId" uuid NOT NULL, "depositAccountId" uuid, CONSTRAINT "CHK_customer_cheque_status" CHECK ("status" IN ('pending', 'cleared', 'bounced')), CONSTRAINT "PK_customer_cheque" PRIMARY KEY ("id"))`,
    );
    // The same cheque is received once, unless it bounced.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_customer_cheque_no" ON "customer_cheque" ("companyId", lower("bankName"), "chequeNo") WHERE "status" <> 'bounced'`,
    );

    for (const [table, column, ref, name] of [
      ['sales_order', 'companyId', 'company', 'FK_sales_order_company'],
      ['sales_order', 'customerId', 'customer', 'FK_sales_order_customer'],
      ['sales_order', 'factoryId', 'factory', 'FK_sales_order_factory'],
      [
        'sales_order',
        'createdById',
        'company_member',
        'FK_sales_order_created',
      ],
      ['order_line', 'companyId', 'company', 'FK_order_line_company'],
      ['order_line', 'orderId', 'sales_order', 'FK_order_line_order'],
      ['order_line', 'materialId', 'catalog_item', 'FK_order_line_material'],
      ['order_line', 'sootTypeId', 'catalog_item', 'FK_order_line_soot'],
      ['order_line', 'sootSizeId', 'piece_size', 'FK_order_line_size'],
      ['order_line', 'counterWidthId', 'catalog_item', 'FK_order_line_width'],
      ['bill', 'companyId', 'company', 'FK_bill_company'],
      ['bill', 'customerId', 'customer', 'FK_bill_customer'],
      ['bill', 'factoryId', 'factory', 'FK_bill_factory'],
      ['bill', 'orderId', 'sales_order', 'FK_bill_order'],
      ['bill', 'createdById', 'company_member', 'FK_bill_created'],
      ['bill_line', 'companyId', 'company', 'FK_bill_line_company'],
      ['bill_line', 'billId', 'bill', 'FK_bill_line_bill'],
      ['bill_line', 'materialId', 'catalog_item', 'FK_bill_line_material'],
      ['bill_line', 'sootTypeId', 'catalog_item', 'FK_bill_line_soot'],
      ['bill_line', 'sootSizeId', 'piece_size', 'FK_bill_line_size'],
      ['bill_line', 'counterWidthId', 'catalog_item', 'FK_bill_line_width'],
      ['bill_line', 'orderLineId', 'order_line', 'FK_bill_line_order_line'],
      ['bill_log', 'companyId', 'company', 'FK_bill_log_company'],
      ['bill_log', 'billId', 'bill', 'FK_bill_log_bill'],
      ['bill_collection', 'companyId', 'company', 'FK_bill_collection_company'],
      ['bill_collection', 'billId', 'bill', 'FK_bill_collection_bill'],
      [
        'bill_collection',
        'createdById',
        'company_member',
        'FK_bill_collection_created',
      ],
      ['collection_line', 'companyId', 'company', 'FK_collection_line_company'],
      [
        'collection_line',
        'collectionId',
        'bill_collection',
        'FK_collection_line_collection',
      ],
      [
        'customer_payment',
        'companyId',
        'company',
        'FK_customer_payment_company',
      ],
      [
        'customer_payment',
        'customerId',
        'customer',
        'FK_customer_payment_customer',
      ],
      [
        'customer_payment',
        'accountId',
        'account',
        'FK_customer_payment_account',
      ],
      ['customer_payment', 'billId', 'bill', 'FK_customer_payment_bill'],
      [
        'customer_payment',
        'orderId',
        'sales_order',
        'FK_customer_payment_order',
      ],
      [
        'customer_payment',
        'createdById',
        'company_member',
        'FK_customer_payment_created',
      ],
      ['customer_cheque', 'companyId', 'company', 'FK_customer_cheque_company'],
      [
        'customer_cheque',
        'paymentId',
        'customer_payment',
        'FK_customer_cheque_payment',
      ],
      [
        'customer_cheque',
        'customerId',
        'customer',
        'FK_customer_cheque_customer',
      ],
      [
        'customer_cheque',
        'depositAccountId',
        'account',
        'FK_customer_cheque_account',
      ],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${ref}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'customer_cheque',
      'customer_payment',
      'collection_line',
      'bill_collection',
      'bill_log',
      'bill_line',
      'bill',
      'order_line',
      'sales_order',
    ]) {
      await queryRunner.query(`DROP TABLE "${table}"`);
    }
  }
}
