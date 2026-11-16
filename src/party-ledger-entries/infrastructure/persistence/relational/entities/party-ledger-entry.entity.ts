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

// Party khata row (supplier, customer, worker, shop). Append-only: a database
// trigger rejects every update and delete; corrections are opposite rows.
@Entity({
  name: 'party_ledger_entry',
})
@Check(
  'CHK_party_ledger_entry_party_type',
  `"partyType" IN ('supplier', 'customer', 'worker', 'shop')`,
)
// Exactly one side, and it is positive.
@Check(
  'CHK_party_ledger_entry_one_side',
  `("charge" IS NOT NULL AND "charge" > 0 AND "credit" IS NULL) OR ("credit" IS NOT NULL AND "credit" > 0 AND "charge" IS NULL)`,
)
@Index('IDX_party_ledger_entry_party', [
  'company',
  'partyType',
  'partyId',
  'date',
])
@Index('IDX_party_ledger_entry_source', ['company', 'sourceType', 'sourceId'])
export class PartyLedgerEntryEntity extends EntityRelationalHelper {
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

  // Paid to / received from the party: reduces what is owed.
  @Column({
    nullable: true,
    type: 'bigint',
    transformer: bigintTransformer,
  })
  credit?: number | null;

  // Owed by / to us: increases the balance.
  @Column({
    nullable: true,
    type: 'bigint',
    transformer: bigintTransformer,
  })
  charge?: number | null;

  // No foreign key yet: suppliers, customers and workers arrive in later modules.
  @Column({
    nullable: false,
    type: 'uuid',
  })
  partyId: string;

  @Column({
    nullable: false,
    type: String,
  })
  partyType: string;

  @Column({
    nullable: false,
    type: 'date',
  })
  date: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  company?: CompanyEntity;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
