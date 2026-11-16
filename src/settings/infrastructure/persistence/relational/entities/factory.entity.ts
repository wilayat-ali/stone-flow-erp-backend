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
import { decimalTransformer } from '../../../../../utils/transformers/decimal.transformer';

// A factory the company owns, or another factory it sends cutting to. Never
// deleted: a deactivated factory is only hidden.
@Entity({ name: 'factory' })
@Check('CHK_factory_kind', `"kind" IN ('own', 'cutting')`)
@Check('CHK_factory_rate', `"ratePerTon" IS NULL OR "ratePerTon" > 0`)
@Index('IDX_factory_company', ['company'])
export class FactoryEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_factory' })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_factory_company' })
  company?: CompanyEntity;

  @Column({ nullable: false, type: String })
  name: string;

  @Column({ nullable: false, type: String })
  kind: string;

  // PKR per ton of cutting; cutting factories only.
  @Column({
    nullable: true,
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: decimalTransformer,
  })
  ratePerTon?: number | null;

  // The last truck mark this factory gave out. Marks continue forever and never
  // reset; Purchases takes the next one when a truck is approved.
  @Column({ nullable: false, type: 'int', default: 0 })
  markCounter: number;

  @Column({ nullable: false, type: Boolean, default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
