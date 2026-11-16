import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';

import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { bigintTransformer } from '../../../../../utils/transformers/bigint.transformer';

// A mine owner, cutting factory or shop we buy from. What we owe them is never
// stored here: it is the opening balance plus the party ledger (partyType
// 'supplier'), calculated on every read.
@Entity({ name: 'supplier' })
@Check(
  'CHK_supplier_type',
  `"type" IN ('mine_owner', 'cutting_factory', 'shop')`,
)
@Check(
  'CHK_supplier_cutting_rate',
  `"cuttingRatePerTon" IS NULL OR "cuttingRatePerTon" > 0`,
)
// One WhatsApp number per company, whatever the dashes look like.
@Index('UQ_supplier_company_phone', ['company', 'phoneDigits'], {
  unique: true,
})
export class SupplierEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_supplier' })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_company' })
  company?: CompanyEntity;

  @Column({ nullable: false, type: String })
  name: string;

  @Column({ nullable: false, type: String })
  type: string;

  // Quarry, workshop or shop name.
  @Column({ nullable: false, type: String, default: '' })
  business: string;

  // As typed, for display.
  @Column({ nullable: false, type: String })
  phone: string;

  // Digits only, so 0333-7812345 and 03337812345 are the same number.
  @Column({ nullable: false, type: String })
  phoneDigits: string;

  @Column({ nullable: false, type: String })
  city: string;

  // PKR per ton; cutting factories only.
  @Column({
    nullable: true,
    type: 'bigint',
    transformer: bigintTransformer,
  })
  cuttingRatePerTon?: number | null;

  // Whole PKR, may be negative: what we already owed (positive) or had paid
  // ahead (negative) before StoneFlow. Not a ledger row, so it can be corrected.
  @Column({
    nullable: false,
    type: 'bigint',
    transformer: bigintTransformer,
    default: 0,
  })
  openingBalance: number;

  // Calendar day (YYYY-MM-DD) kept as a string so no timezone can shift it.
  @Column({ nullable: false, type: 'date' })
  openingDate: string;

  @Column({ nullable: false, type: Boolean, default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
