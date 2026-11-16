import { MigrationInterface, QueryRunner } from 'typeorm';
import { DEFAULT_ROLE_PERMISSIONS } from '../../tenancy/permissions';

export class AddRolePermissions1794400000000 implements MigrationInterface {
  name = 'AddRolePermissions1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_role" ADD "description" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_role" ADD "permissions" jsonb NOT NULL DEFAULT '[]'`,
    );

    // The five roles every company already has start with their defaults.
    for (const [key, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      await queryRunner.query(
        `UPDATE "company_role" SET "permissions" = $1::jsonb WHERE "key" = $2 AND "isSystem" = true`,
        [JSON.stringify(permissions), key],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_role" DROP COLUMN "permissions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_role" DROP COLUMN "description"`,
    );
  }
}
