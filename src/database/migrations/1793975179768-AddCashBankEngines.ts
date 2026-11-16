import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCashBankEngines1793975179768 implements MigrationInterface {
  name = 'AddCashBankEngines1793975179768';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "stock_movement" ("note" character varying, "sourceId" uuid, "sourceType" character varying NOT NULL, "inches" integer, "qty" integer NOT NULL, "finish" character varying, "counterWidthId" uuid, "sootSizeId" uuid, "sootTypeId" uuid, "materialId" uuid NOT NULL, "itemType" character varying NOT NULL, "factoryId" uuid NOT NULL, "date" date NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "createdByMemberId" uuid NOT NULL, "companyId" uuid NOT NULL, CONSTRAINT "CHK_stock_movement_item_shape" CHECK (("itemType" = 'piece' AND "sootTypeId" IS NOT NULL AND "sootSizeId" IS NOT NULL AND "finish" IS NOT NULL AND "counterWidthId" IS NULL AND "inches" IS NULL)
   OR ("itemType" = 'counter' AND "counterWidthId" IS NOT NULL AND "finish" IS NOT NULL AND "inches" IS NOT NULL AND "sootTypeId" IS NULL AND "sootSizeId" IS NULL)
   OR ("itemType" = 'slab' AND "sootTypeId" IS NULL AND "sootSizeId" IS NULL AND "counterWidthId" IS NULL AND "finish" IS NULL AND "inches" IS NULL)), CONSTRAINT "CHK_stock_movement_qty" CHECK ("qty" <> 0), CONSTRAINT "CHK_stock_movement_finish" CHECK ("finish" IS NULL OR "finish" IN ('polished', 'unpolished')), CONSTRAINT "CHK_stock_movement_item_type" CHECK ("itemType" IN ('piece', 'counter', 'slab')), CONSTRAINT "PK_9fe1232f916686ae8cf00294749" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_movement_source" ON "stock_movement" ("companyId", "sourceType", "sourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_movement_item" ON "stock_movement" ("companyId", "factoryId", "itemType", "materialId", "sootTypeId", "sootSizeId", "counterWidthId", "finish") `,
    );
    await queryRunner.query(
      `CREATE TABLE "party_ledger_entry" ("note" character varying, "sourceId" uuid, "sourceType" character varying NOT NULL, "credit" bigint, "charge" bigint, "partyId" uuid NOT NULL, "partyType" character varying NOT NULL, "date" date NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "CHK_party_ledger_entry_one_side" CHECK (("charge" IS NOT NULL AND "charge" > 0 AND "credit" IS NULL) OR ("credit" IS NOT NULL AND "credit" > 0 AND "charge" IS NULL)), CONSTRAINT "CHK_party_ledger_entry_party_type" CHECK ("partyType" IN ('supplier', 'customer', 'worker', 'shop')), CONSTRAINT "PK_950f9b1b62550f4fe7234419ced" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_party_ledger_entry_source" ON "party_ledger_entry" ("companyId", "sourceType", "sourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_party_ledger_entry_party" ON "party_ledger_entry" ("companyId", "partyType", "partyId", "date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "account" ("isActive" boolean NOT NULL DEFAULT true, "openingDate" date NOT NULL, "openingBalance" bigint NOT NULL DEFAULT '0', "last4" character varying, "name" character varying NOT NULL, "kind" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "CHK_account_kind" CHECK ("kind" IN ('cash', 'bank')), CONSTRAINT "PK_54115ee388cdb6d86bb4bf5b2ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_account_company_cash" ON "account" ("companyId") WHERE "kind" = 'cash'`,
    );
    await queryRunner.query(
      `CREATE TABLE "ledger_entry" ("note" character varying, "sourceId" uuid, "sourceType" character varying NOT NULL, "partyId" uuid, "partyType" character varying, "amount" bigint NOT NULL, "direction" character varying NOT NULL, "date" date NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "reversedById" uuid, "createdByMemberId" uuid NOT NULL, "accountId" uuid NOT NULL, "companyId" uuid NOT NULL, CONSTRAINT "CHK_ledger_entry_party_type" CHECK ("partyType" IS NULL OR "partyType" IN ('supplier', 'customer', 'worker', 'shop', 'none')), CONSTRAINT "CHK_ledger_entry_amount" CHECK ("amount" > 0), CONSTRAINT "CHK_ledger_entry_direction" CHECK ("direction" IN ('in', 'out')), CONSTRAINT "PK_04e9d274911f909a5848a15cd74" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ledger_entry_party" ON "ledger_entry" ("companyId", "partyType", "partyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ledger_entry_source" ON "ledger_entry" ("companyId", "sourceType", "sourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ledger_entry_account_date" ON "ledger_entry" ("companyId", "accountId", "date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "approval" ("payload" jsonb, "reason" character varying, "decidedAt" TIMESTAMP, "status" character varying NOT NULL DEFAULT 'pending', "entityId" uuid, "entityType" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "decidedByMemberId" uuid, "requestedByMemberId" uuid NOT NULL, "companyId" uuid NOT NULL, CONSTRAINT "CHK_approval_reject_reason" CHECK ("status" <> 'rejected' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)), CONSTRAINT "CHK_approval_not_self" CHECK ("decidedByMemberId" IS NULL OR "decidedByMemberId" <> "requestedByMemberId"), CONSTRAINT "CHK_approval_decided" CHECK (("status" = 'pending' AND "decidedAt" IS NULL) OR ("status" IN ('approved', 'rejected') AND "decidedAt" IS NOT NULL)), CONSTRAINT "CHK_approval_status" CHECK ("status" IN ('pending', 'approved', 'rejected')), CONSTRAINT "PK_97bfd1cd9dff3c1302229da6b5c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_approval_entity" ON "approval" ("companyId", "entityType", "entityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_approval_status" ON "approval" ("companyId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movement" ADD CONSTRAINT "FK_52b69bf3ba7e2e16d853236235a" FOREIGN KEY ("createdByMemberId") REFERENCES "company_member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movement" ADD CONSTRAINT "FK_8da1e9eae88d9bcfdc7fad93b40" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "party_ledger_entry" ADD CONSTRAINT "FK_b33fafba40d7e056a0447f5b61b" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "account" ADD CONSTRAINT "FK_2d01dcea17c1dbaa448a235ac57" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entry" ADD CONSTRAINT "FK_e897d5f408d1889c8091c859611" FOREIGN KEY ("reversedById") REFERENCES "ledger_entry"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entry" ADD CONSTRAINT "FK_2e63c0141a6dd01f9a17e54c156" FOREIGN KEY ("createdByMemberId") REFERENCES "company_member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entry" ADD CONSTRAINT "FK_d02a6aa67832567d5866141bc0e" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entry" ADD CONSTRAINT "FK_e40f81363189a8ff71de0738158" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval" ADD CONSTRAINT "FK_46992c59ad7aafdffd38b84da57" FOREIGN KEY ("decidedByMemberId") REFERENCES "company_member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval" ADD CONSTRAINT "FK_dbd6f97c18cd26cea50216762f9" FOREIGN KEY ("requestedByMemberId") REFERENCES "company_member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval" ADD CONSTRAINT "FK_25895aed41570afc185d6a07386" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // Append-only guards (hand-written; TypeORM cannot generate triggers).
    // Ledger and stock rows are never edited or deleted: corrections are new
    // rows. The one allowed change is setting ledger_entry.reversedById once.
    await queryRunner.query(`
      CREATE FUNCTION "append_only_guard"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% rows are append-only: post a correcting row instead', TG_TABLE_NAME
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE FUNCTION "ledger_entry_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'UPDATE'
           AND OLD."reversedById" IS NULL
           AND NEW."reversedById" IS NOT NULL
           AND (to_jsonb(NEW) - 'reversedById' - 'updatedAt')
             = (to_jsonb(OLD) - 'reversedById' - 'updatedAt') THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'ledger_entry rows are append-only: post a reversal instead'
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `CREATE TRIGGER "TRG_ledger_entry_append_only" BEFORE UPDATE OR DELETE ON "ledger_entry" FOR EACH ROW EXECUTE FUNCTION "ledger_entry_guard"()`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "TRG_party_ledger_entry_append_only" BEFORE UPDATE OR DELETE ON "party_ledger_entry" FOR EACH ROW EXECUTE FUNCTION "append_only_guard"()`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "TRG_stock_movement_append_only" BEFORE UPDATE OR DELETE ON "stock_movement" FOR EACH ROW EXECUTE FUNCTION "append_only_guard"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_stock_movement_append_only" ON "stock_movement"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_party_ledger_entry_append_only" ON "party_ledger_entry"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_ledger_entry_append_only" ON "ledger_entry"`,
    );
    await queryRunner.query(`DROP FUNCTION "ledger_entry_guard"()`);
    await queryRunner.query(`DROP FUNCTION "append_only_guard"()`);
    await queryRunner.query(
      `ALTER TABLE "approval" DROP CONSTRAINT "FK_25895aed41570afc185d6a07386"`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval" DROP CONSTRAINT "FK_dbd6f97c18cd26cea50216762f9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval" DROP CONSTRAINT "FK_46992c59ad7aafdffd38b84da57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entry" DROP CONSTRAINT "FK_e40f81363189a8ff71de0738158"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entry" DROP CONSTRAINT "FK_d02a6aa67832567d5866141bc0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entry" DROP CONSTRAINT "FK_2e63c0141a6dd01f9a17e54c156"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entry" DROP CONSTRAINT "FK_e897d5f408d1889c8091c859611"`,
    );
    await queryRunner.query(
      `ALTER TABLE "account" DROP CONSTRAINT "FK_2d01dcea17c1dbaa448a235ac57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "party_ledger_entry" DROP CONSTRAINT "FK_b33fafba40d7e056a0447f5b61b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movement" DROP CONSTRAINT "FK_8da1e9eae88d9bcfdc7fad93b40"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movement" DROP CONSTRAINT "FK_52b69bf3ba7e2e16d853236235a"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_approval_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_approval_entity"`);
    await queryRunner.query(`DROP TABLE "approval"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ledger_entry_account_date"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ledger_entry_source"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ledger_entry_party"`);
    await queryRunner.query(`DROP TABLE "ledger_entry"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_account_company_cash"`);
    await queryRunner.query(`DROP TABLE "account"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_party_ledger_entry_party"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_party_ledger_entry_source"`,
    );
    await queryRunner.query(`DROP TABLE "party_ledger_entry"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_movement_item"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_movement_source"`);
    await queryRunner.query(`DROP TABLE "stock_movement"`);
  }
}
