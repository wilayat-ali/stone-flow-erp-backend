import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';
import { CatalogItemEntity } from './catalog-item.entity';

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

// A size a soot type is cut into, e.g. 12x24 (width x length in inches). Stock
// of pieces is counted per soot type and size. Never deleted: hiding only.
@Entity({ name: 'piece_size' })
@Check('CHK_piece_size_dimensions', `"widthInches" > 0 AND "lengthInches" > 0`)
@Index('UQ_piece_size_label', ['company', 'sootType', 'label'], {
  unique: true,
})
export class PieceSizeEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_piece_size' })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_piece_size_company' })
  company?: CompanyEntity;

  // One of the soot sizes in Settings (14 soot, 6 soot, ...).
  @ManyToOne(() => CatalogItemEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_piece_size_soot_type' })
  sootType: CatalogItemEntity;

  // "12x24": width x length in inches.
  @Column({ nullable: false, type: String })
  label: string;

  @Column({
    nullable: false,
    type: 'numeric',
    precision: 8,
    scale: 2,
    transformer: decimalTransformer,
  })
  widthInches: number;

  @Column({
    nullable: false,
    type: 'numeric',
    precision: 8,
    scale: 2,
    transformer: decimalTransformer,
  })
  lengthInches: number;

  @Column({ nullable: false, type: Boolean, default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
