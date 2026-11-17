import { CompanyMemberEntity } from '../../../../../company-members/infrastructure/persistence/relational/entities/company-member.entity';
import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';
import { CatalogItemEntity } from '../../../../../settings/infrastructure/persistence/relational/entities/catalog-item.entity';
import { FactoryEntity } from '../../../../../settings/infrastructure/persistence/relational/entities/factory.entity';
import { PieceSizeEntity } from '../../../../../settings/infrastructure/persistence/relational/entities/piece-size.entity';

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

// The only way to change stock outside production and sales (rules §6): opening
// stock (owner only), an adjustment up or down with a reason, or a transfer
// between two of our factories. It waits as 'pending' (no effect on stock) for a
// Munshi while approval is on; the movement is posted to the stock engine when
// it counts. Stock itself is never stored here.
@Entity({ name: 'stock_entry' })
@Check(
  'CHK_stock_entry_type',
  `"type" IN ('opening', 'adjustment', 'transfer')`,
)
@Check(
  'CHK_stock_entry_status',
  `"status" IN ('pending', 'approved', 'rejected')`,
)
@Check('CHK_stock_entry_direction', `"direction" IN (1, -1)`)
@Check('CHK_stock_entry_qty', `"qty" > 0`)
@Check(
  'CHK_stock_entry_reason',
  `"reason" IS NULL OR "reason" IN ('broken', 'mismatch', 'other')`,
)
@Index('UQ_stock_entry_no', ['company', 'entrySeq'], { unique: true })
@Index('IDX_stock_entry_status', ['company', 'status', 'date'])
export class StockEntryEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_stock_entry',
  })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_entry_company' })
  company?: CompanyEntity;

  // SE-001, SE-002 ... continues per company and never repeats.
  @Column({ nullable: false, type: 'int' })
  entrySeq: number;

  @Column({ nullable: false, type: String })
  type: string;

  // Business day (YYYY-MM-DD) kept as a string so no timezone can shift it.
  @Column({ nullable: false, type: 'date' })
  date: string;

  // 1 adds, -1 removes; adjustments only (opening always adds, a transfer moves).
  @Column({ nullable: false, type: 'smallint' })
  direction: number;

  @Column({ nullable: true, type: String })
  reason?: string | null;

  @Column({ nullable: false, type: String, default: '' })
  note: string;

  // ---- the item (the engine's key: type | material | factory | soot | size | width | finish)

  @ManyToOne(() => FactoryEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_entry_factory' })
  factory: FactoryEntity;

  @Column({ nullable: false, type: String })
  itemType: string;

  @ManyToOne(() => CatalogItemEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_entry_material' })
  material: CatalogItemEntity;

  @ManyToOne(() => CatalogItemEntity, { eager: false, nullable: true })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_entry_soot_type' })
  sootType?: CatalogItemEntity | null;

  @ManyToOne(() => PieceSizeEntity, { eager: false, nullable: true })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_entry_soot_size' })
  sootSize?: PieceSizeEntity | null;

  @ManyToOne(() => CatalogItemEntity, { eager: false, nullable: true })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_entry_counter_width' })
  counterWidth?: CatalogItemEntity | null;

  @Column({ nullable: true, type: String })
  finish?: string | null;

  // Pieces, counter pieces or slabs.
  @Column({ nullable: false, type: 'int' })
  qty: number;

  // Total inches of length; counters only.
  @Column({ nullable: true, type: 'int' })
  inches?: number | null;

  // A transfer's destination.
  @ManyToOne(() => FactoryEntity, { eager: false, nullable: true })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_entry_to_factory' })
  toFactory?: FactoryEntity | null;

  @Column({ nullable: false, type: String })
  status: string;

  @Column({ nullable: true, type: String })
  rejectReason?: string | null;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_entry_created_by' })
  createdBy: CompanyMemberEntity;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: true })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_entry_approved_by' })
  approvedBy?: CompanyMemberEntity | null;

  // The approval this entry went through (engine record), to decide it later.
  @Column({ nullable: true, type: 'uuid' })
  approvalId?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
