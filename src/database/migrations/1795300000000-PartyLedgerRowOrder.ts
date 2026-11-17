import { MigrationInterface, QueryRunner } from 'typeorm';

// Rows posted in one transaction (a bill, its payment, a reversal and a new
// charge) all got the same createdAt, so a khata could show them in any order.
// The clock time of each insert keeps them in the order they were posted.
export class PartyLedgerRowOrder1795300000000 implements MigrationInterface {
  name = 'PartyLedgerRowOrder1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "party_ledger_entry" ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "party_ledger_entry" ALTER COLUMN "createdAt" SET DEFAULT now()`,
    );
  }
}
