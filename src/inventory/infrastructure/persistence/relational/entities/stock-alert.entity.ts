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

// "Tell me when this item runs low": the quantity below which an item shows as
// low. One row per item; setting 0 removes it. Only the engine's key is
// stored, as one text value so an item with no soot or width still compares.
@Entity({ name: 'stock_alert' })
@Check('CHK_stock_alert_min_qty', `"minQty" > 0`)
@Index('UQ_stock_alert_item', ['company', 'itemKey'], { unique: true })
export class StockAlertEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_stock_alert',
  })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_stock_alert_company' })
  company?: CompanyEntity;

  // itemType|factoryId|materialId|sootTypeId|sootSizeId|counterWidthId|finish
  @Column({ nullable: false, type: String })
  itemKey: string;

  @Column({ nullable: false, type: 'int' })
  minQty: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
