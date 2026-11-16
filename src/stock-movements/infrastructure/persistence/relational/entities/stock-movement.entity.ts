import { CompanyMemberEntity } from '../../../../../company-members/infrastructure/persistence/relational/entities/company-member.entity';

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

// Append-only: a database trigger rejects every update and delete; corrections
// are opposite movements. On-hand stock is the sum of these rows (rules §2.2).
@Entity({
  name: 'stock_movement',
})
@Check(
  'CHK_stock_movement_item_type',
  `"itemType" IN ('piece', 'counter', 'slab')`,
)
@Check(
  'CHK_stock_movement_finish',
  `"finish" IS NULL OR "finish" IN ('polished', 'unpolished')`,
)
@Check('CHK_stock_movement_qty', `"qty" <> 0`)
// Item key shape per type (rules §2.2): pieces have soot + size + finish,
// counters have width + finish + inches, slabs have only material + factory.
@Check(
  'CHK_stock_movement_item_shape',
  `("itemType" = 'piece' AND "sootTypeId" IS NOT NULL AND "sootSizeId" IS NOT NULL AND "finish" IS NOT NULL AND "counterWidthId" IS NULL AND "inches" IS NULL)
   OR ("itemType" = 'counter' AND "counterWidthId" IS NOT NULL AND "finish" IS NOT NULL AND "inches" IS NOT NULL AND "sootTypeId" IS NULL AND "sootSizeId" IS NULL)
   OR ("itemType" = 'slab' AND "sootTypeId" IS NULL AND "sootSizeId" IS NULL AND "counterWidthId" IS NULL AND "finish" IS NULL AND "inches" IS NULL)`,
)
@Index('IDX_stock_movement_item', [
  'company',
  'factoryId',
  'itemType',
  'materialId',
  'sootTypeId',
  'sootSizeId',
  'counterWidthId',
  'finish',
])
@Index('IDX_stock_movement_source', ['company', 'sourceType', 'sourceId'])
export class StockMovementEntity extends EntityRelationalHelper {
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

  // Signed total inches of length, counters only.
  @Column({
    nullable: true,
    type: Number,
  })
  inches?: number | null;

  // Signed: pieces, counter pieces or slabs.
  @Column({
    nullable: false,
    type: Number,
  })
  qty: number;

  @Column({
    nullable: true,
    type: String,
  })
  finish?: string | null;

  // The five ids below have no foreign key yet: factories, materials, soot
  // types/sizes and counter widths arrive with the Settings backend.
  @Column({
    nullable: true,
    type: 'uuid',
  })
  counterWidthId?: string | null;

  @Column({
    nullable: true,
    type: 'uuid',
  })
  sootSizeId?: string | null;

  @Column({
    nullable: true,
    type: 'uuid',
  })
  sootTypeId?: string | null;

  @Column({
    nullable: false,
    type: 'uuid',
  })
  materialId: string;

  @Column({
    nullable: false,
    type: String,
  })
  itemType: string;

  @Column({
    nullable: false,
    type: 'uuid',
  })
  factoryId: string;

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
