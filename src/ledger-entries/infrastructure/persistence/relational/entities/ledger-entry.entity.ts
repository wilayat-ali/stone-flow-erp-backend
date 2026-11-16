import { CompanyMemberEntity } from '../../../../../company-members/infrastructure/persistence/relational/entities/company-member.entity';

import { AccountEntity } from '../../../../../accounts/infrastructure/persistence/relational/entities/account.entity';

import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';

import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  Column,
  Check,
  Index,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { bigintTransformer } from '../../../../../utils/transformers/bigint.transformer';

// Append-only: a database trigger rejects deletes, and the only update it
// allows is setting reversedBy once. Corrections are reversal rows.
@Entity({
  name: 'ledger_entry',
})
@Check('CHK_ledger_entry_direction', `"direction" IN ('in', 'out')`)
@Check('CHK_ledger_entry_amount', `"amount" > 0`)
@Check(
  'CHK_ledger_entry_party_type',
  `"partyType" IS NULL OR "partyType" IN ('supplier', 'customer', 'worker', 'shop', 'none')`,
)
@Index('IDX_ledger_entry_account_date', ['company', 'account', 'date'])
@Index('IDX_ledger_entry_source', ['company', 'sourceType', 'sourceId'])
@Index('IDX_ledger_entry_party', ['company', 'partyType', 'partyId'])
export class LedgerEntryEntity extends EntityRelationalHelper {
  // Set once, on the original row, to the reversal row that cancels it.
  @ManyToOne(() => LedgerEntryEntity, { eager: false, nullable: true })
  reversedBy?: LedgerEntryEntity | null;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: false })
  createdByMember?: CompanyMemberEntity;

  @Column({
    nullable: true,
    type: String,
  })
  note?: string | null;

  @Column({
    nullable: true,
    type: 'uuid',
  })
  sourceId?: string | null;

  @Column({
    nullable: false,
    type: String,
  })
  sourceType: string;

  @Column({
    nullable: true,
    type: 'uuid',
  })
  partyId?: string | null;

  @Column({
    nullable: true,
    type: String,
  })
  partyType?: string | null;

  // Whole PKR, always positive; the direction says which way it moves.
  @Column({
    nullable: false,
    type: 'bigint',
    transformer: bigintTransformer,
  })
  amount: number;

  @Column({
    nullable: false,
    type: String,
  })
  direction: string;

  // Calendar day (YYYY-MM-DD) kept as a string so no timezone can shift it.
  @Column({
    nullable: false,
    type: 'date',
  })
  date: string;

  @ManyToOne(() => AccountEntity, { eager: false, nullable: false })
  account?: AccountEntity;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  company?: CompanyEntity;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
