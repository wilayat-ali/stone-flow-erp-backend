import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';

import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
  ManyToOne,
  Check,
  Index,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { bigintTransformer } from '../../../../../utils/transformers/bigint.transformer';

@Entity({
  name: 'account',
})
@Check('CHK_account_kind', `"kind" IN ('cash', 'bank')`)
// A company may keep several cash accounts (cash in hand, the munshi's petty cash, ...).
@Index('IDX_account_company', ['company'])
export class AccountEntity extends EntityRelationalHelper {
  @Column({
    nullable: false,
    type: Boolean,
    default: true,
  })
  isActive: boolean;

  // Calendar day (YYYY-MM-DD) kept as a string so no timezone can shift it.
  @Column({
    nullable: false,
    type: 'date',
  })
  openingDate: string;

  // Whole PKR, may be negative. Only the source for the 'opening' ledger row
  // posted when the account is created; balances are always read from the ledger.
  @Column({
    nullable: false,
    type: 'bigint',
    transformer: bigintTransformer,
    default: 0,
  })
  openingBalance: number;

  @Column({
    nullable: true,
    type: String,
  })
  last4?: string | null;

  @Column({
    nullable: false,
    type: String,
  })
  name: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  company?: CompanyEntity;

  @Column({
    nullable: false,
    type: String,
  })
  kind: string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
