import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';
import { FactoryEntity } from './factory.entity';

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

// A cutting machine in one of the company's own factories. Never deleted.
@Entity({ name: 'machine' })
@Check(
  'CHK_machine_type',
  `"type" IN ('vertical', 'gangSaw', 'monolama', 'blockCutter')`,
)
@Index('IDX_machine_company', ['company'])
export class MachineEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_machine' })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_machine_company' })
  company?: CompanyEntity;

  @ManyToOne(() => FactoryEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_machine_factory' })
  factory: FactoryEntity;

  @Column({ nullable: false, type: String })
  name: string;

  @Column({ nullable: false, type: String })
  type: string;

  @Column({ nullable: false, type: String })
  dayThekadar: string;

  // Most factories run one shift; night is optional.
  @Column({ nullable: true, type: String })
  nightThekadar?: string | null;

  @Column({ nullable: false, type: Boolean, default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
