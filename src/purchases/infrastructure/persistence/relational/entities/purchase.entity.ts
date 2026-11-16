import { CompanyMemberEntity } from '../../../../../company-members/infrastructure/persistence/relational/entities/company-member.entity';
import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';
import { FactoryEntity } from '../../../../../settings/infrastructure/persistence/relational/entities/factory.entity';
import { SupplierEntity } from '../../../../../suppliers/infrastructure/persistence/relational/entities/supplier.entity';

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
import { decimalTransformer } from '../../../../../utils/transformers/decimal.transformer';

// One truck of stone bought from a supplier (rules §5). A munshi's truck waits
// as 'pending' (no charge, no mark) until it is approved; everything it does to
// the money lives in the party ledger, never here. 'cutting' and 'cut' are set
// by Production, which owns those steps.
@Entity({ name: 'purchase' })
@Check(
  'CHK_purchase_status',
  `"status" IN ('pending', 'in_stock', 'cutting', 'cut', 'rejected', 'cancelled')`,
)
@Check('CHK_purchase_tons', `"tons" > 0`)
@Check('CHK_purchase_rate', `"ratePerTon" > 0`)
@Check('CHK_purchase_money', `"discount" >= 0 AND "total" >= 0`)
@Check('CHK_purchase_stones', `"stones" BETWEEN 1 AND 20`)
// The same purchi from the same supplier is entered once, unless that entry
// was rejected or cancelled.
@Index('UQ_purchase_purchi', ['company', 'supplier', 'purchiNo'], {
  unique: true,
  where: `"status" NOT IN ('rejected', 'cancelled')`,
})
// A factory's marks continue forever and never repeat.
@Index('UQ_purchase_mark', ['factory', 'markSeq'], {
  unique: true,
  where: `"markSeq" IS NOT NULL`,
})
@Index('IDX_purchase_company_status', ['company', 'status', 'date'])
export class PurchaseEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_purchase' })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_purchase_company' })
  company?: CompanyEntity;

  @ManyToOne(() => SupplierEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_purchase_supplier' })
  supplier: SupplierEntity;

  @ManyToOne(() => FactoryEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_purchase_factory' })
  factory: FactoryEntity;

  // Business day (YYYY-MM-DD) kept as a string so no timezone can shift it.
  @Column({ nullable: false, type: 'date' })
  date: string;

  @Column({ nullable: false, type: String })
  material: string;

  // Number on the kanta purchi from the mine owner.
  @Column({ nullable: false, type: String })
  purchiNo: string;

  @Column({ nullable: false, type: String })
  truckNo: string;

  @Column({
    nullable: false,
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  tons: number;

  // PKR per ton, as written on the purchi.
  @Column({
    nullable: false,
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: decimalTransformer,
  })
  ratePerTon: number;

  @Column({
    nullable: false,
    type: 'bigint',
    transformer: bigintTransformer,
    default: 0,
  })
  discount: number;

  // tons x ratePerTon - discount, whole rupees, never below 0. Worked out by
  // the server, never taken from the request.
  @Column({
    nullable: false,
    type: 'bigint',
    transformer: bigintTransformer,
  })
  total: number;

  // How many stones the truck is cut into (usually 2 to 5).
  @Column({ nullable: false, type: 'int' })
  stones: number;

  // Taken from the factory's own counter when the truck is approved, so a
  // rejected truck wastes none.
  @Column({ nullable: true, type: 'int' })
  markSeq?: number | null;

  @Column({ nullable: false, type: String })
  status: string;

  @Column({ nullable: false, type: String, default: '' })
  note: string;

  // Why it was rejected or cancelled.
  @Column({ nullable: true, type: String })
  reason?: string | null;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_purchase_created_by' })
  createdBy: CompanyMemberEntity;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: true })
  @JoinColumn({ foreignKeyConstraintName: 'FK_purchase_approved_by' })
  approvedBy?: CompanyMemberEntity | null;

  // The approval this truck went through (engine record), to decide it later.
  @Column({ nullable: true, type: 'uuid' })
  approvalId?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
