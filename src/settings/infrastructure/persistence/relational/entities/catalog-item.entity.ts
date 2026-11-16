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

// The plain name lists in Settings: soot sizes, counter widths and expense
// categories. One table, told apart by `kind`; later modules point at a row by id.
@Entity({ name: 'catalog_item' })
@Check(
  'CHK_catalog_item_kind',
  `"kind" IN ('soot_size', 'counter_width', 'expense_category')`,
)
@Index('IDX_catalog_item_company_kind', ['company', 'kind'])
export class CatalogItemEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_catalog_item',
  })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_catalog_item_company' })
  company?: CompanyEntity;

  @Column({ nullable: false, type: String })
  kind: string;

  @Column({ nullable: false, type: String })
  name: string;

  @Column({ nullable: false, type: Boolean, default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
