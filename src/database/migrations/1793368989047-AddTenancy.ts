import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenancy1793368989047 implements MigrationInterface {
  name = 'AddTenancy1793368989047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "super_admin" ("lastLoginAt" TIMESTAMP, "status" character varying NOT NULL DEFAULT 'active', "role" character varying NOT NULL, "passwordHash" character varying NOT NULL, "email" character varying NOT NULL, "name" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_1ce171ef935f892c7f13004f232" UNIQUE ("email"), CONSTRAINT "PK_3c4fab866f4c62a54ee1ebb1fe3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "company" ("currency" character varying NOT NULL DEFAULT 'PKR', "parchiLanguage" character varying NOT NULL DEFAULT 'en_ur', "approvalRequired" boolean NOT NULL DEFAULT true, "ntn" character varying, "address" character varying, "phone" character varying, "status" character varying NOT NULL DEFAULT 'active', "slug" character varying NOT NULL, "name" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "ownerUserId" integer NOT NULL, CONSTRAINT "UQ_47216baa0f0c8ebc6ee5a74989c" UNIQUE ("slug"), CONSTRAINT "PK_056f7854a7afdba7cbd6d45fc20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7a5d746408a6b4beff6af4b93" ON "company" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "company_role" ("isSystem" boolean NOT NULL DEFAULT false, "key" character varying NOT NULL, "name" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "UQ_1dbee83fcfc7e737102d1578115" UNIQUE ("companyId", "key"), CONSTRAINT "PK_49231276e6dad6ceb8103a461f0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "company_platform" ("isEnabled" boolean NOT NULL DEFAULT false, "platformKey" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid NOT NULL, CONSTRAINT "UQ_0a3b5827fc8480dbace811d75b0" UNIQUE ("companyId", "platformKey"), CONSTRAINT "PK_4d396b71d4e3edda19559fdfac1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "company_member" ("joinedAt" TIMESTAMP, "status" character varying NOT NULL DEFAULT 'invited', "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "invitedByMemberId" uuid, "roleId" uuid NOT NULL, "userId" integer NOT NULL, "companyId" uuid NOT NULL, CONSTRAINT "UQ_d198f671fc2d7c8fe8d4944d0ed" UNIQUE ("companyId", "userId"), CONSTRAINT "PK_50735265431b38042b357626756" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c3009db3b4315829bf43e1ea71" ON "company_member" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "company_invitation" ("acceptedAt" TIMESTAMP, "status" character varying NOT NULL DEFAULT 'pending', "expiresAt" TIMESTAMP NOT NULL, "tokenHash" character varying NOT NULL, "email" character varying, "phone" character varying, "type" character varying NOT NULL DEFAULT 'invite', "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "invitedByMemberId" uuid, "userId" integer, "roleId" uuid, "companyId" uuid NOT NULL, CONSTRAINT "UQ_b3db17aafd9d52dd58174cf2c5f" UNIQUE ("tokenHash"), CONSTRAINT "PK_ee97180f150b3bd7a9eab87221d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_87644b79334016ad4f4a3626be" ON "company_invitation" ("companyId", "email") WHERE "status" = 'pending' AND "email" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_201161bff2ca4317e07c97d23a" ON "company_invitation" ("companyId", "phone") WHERE "status" = 'pending' AND "phone" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_log" ("metadata" text, "targetId" character varying, "targetType" character varying, "action" character varying NOT NULL, "actorId" character varying NOT NULL, "actorType" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "companyId" uuid, CONSTRAINT "PK_07fefa57f7f5ab8fc3f52b3ed0b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_115984fdabb1d86b2c201a186f" ON "audit_log" ("companyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_78e013ffae12f5a1fc1dbefff9" ON "audit_log" ("createdAt") `,
    );
    await queryRunner.query(`ALTER TABLE "user" ADD "lastLoginAt" TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD "phoneVerifiedAt" TIMESTAMP`,
    );
    await queryRunner.query(`ALTER TABLE "user" ADD "phone" character varying`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_8e1f623798118e629b46a9e6299" UNIQUE ("phone")`,
    );
    await queryRunner.query(`ALTER TABLE "session" ADD "activeCompanyId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "CHK_f858cee44427f47da90a82a5f5" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "company" ADD CONSTRAINT "FK_64a4f1809ccb037b28a730153b8" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "session" ADD CONSTRAINT "FK_16873986306a99d7fa0fe11fbac" FOREIGN KEY ("activeCompanyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_role" ADD CONSTRAINT "FK_5a5fd8e8a498f24834563d344bb" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_platform" ADD CONSTRAINT "FK_7691064f1fb310c28bfae2dfa5e" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_member" ADD CONSTRAINT "FK_68a86852fdde62092c8f367e35f" FOREIGN KEY ("invitedByMemberId") REFERENCES "company_member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_member" ADD CONSTRAINT "FK_be52a9428567be0add728b1e084" FOREIGN KEY ("roleId") REFERENCES "company_role"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_member" ADD CONSTRAINT "FK_c3009db3b4315829bf43e1ea711" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_member" ADD CONSTRAINT "FK_24e3f0ad735ec89bb235a395547" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_invitation" ADD CONSTRAINT "FK_07935261cad18788300a7cd919d" FOREIGN KEY ("invitedByMemberId") REFERENCES "company_member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_invitation" ADD CONSTRAINT "FK_3bf6e2852c22310e1cb55fe9a5e" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_invitation" ADD CONSTRAINT "FK_f3dd748ff519d572349e5c7d80d" FOREIGN KEY ("roleId") REFERENCES "company_role"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_invitation" ADD CONSTRAINT "FK_74ff2d6744b387bd665e0fb8d6a" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ADD CONSTRAINT "FK_115984fdabb1d86b2c201a186f1" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_log" DROP CONSTRAINT "FK_115984fdabb1d86b2c201a186f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_invitation" DROP CONSTRAINT "FK_74ff2d6744b387bd665e0fb8d6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_invitation" DROP CONSTRAINT "FK_f3dd748ff519d572349e5c7d80d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_invitation" DROP CONSTRAINT "FK_3bf6e2852c22310e1cb55fe9a5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_invitation" DROP CONSTRAINT "FK_07935261cad18788300a7cd919d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_member" DROP CONSTRAINT "FK_24e3f0ad735ec89bb235a395547"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_member" DROP CONSTRAINT "FK_c3009db3b4315829bf43e1ea711"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_member" DROP CONSTRAINT "FK_be52a9428567be0add728b1e084"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_member" DROP CONSTRAINT "FK_68a86852fdde62092c8f367e35f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_platform" DROP CONSTRAINT "FK_7691064f1fb310c28bfae2dfa5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_role" DROP CONSTRAINT "FK_5a5fd8e8a498f24834563d344bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session" DROP CONSTRAINT "FK_16873986306a99d7fa0fe11fbac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company" DROP CONSTRAINT "FK_64a4f1809ccb037b28a730153b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "CHK_f858cee44427f47da90a82a5f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session" DROP COLUMN "activeCompanyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "UQ_8e1f623798118e629b46a9e6299"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "phone"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "phoneVerifiedAt"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "lastLoginAt"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_78e013ffae12f5a1fc1dbefff9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_115984fdabb1d86b2c201a186f"`,
    );
    await queryRunner.query(`DROP TABLE "audit_log"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_201161bff2ca4317e07c97d23a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_87644b79334016ad4f4a3626be"`,
    );
    await queryRunner.query(`DROP TABLE "company_invitation"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c3009db3b4315829bf43e1ea71"`,
    );
    await queryRunner.query(`DROP TABLE "company_member"`);
    await queryRunner.query(`DROP TABLE "company_platform"`);
    await queryRunner.query(`DROP TABLE "company_role"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b7a5d746408a6b4beff6af4b93"`,
    );
    await queryRunner.query(`DROP TABLE "company"`);
    await queryRunner.query(`DROP TABLE "super_admin"`);
  }
}
