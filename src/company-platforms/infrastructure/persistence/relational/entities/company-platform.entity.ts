import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';

import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  Column,
  Unique,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Unique(['company', 'platformKey'])
@Entity({
  name: 'company_platform',
})
export class CompanyPlatformEntity extends EntityRelationalHelper {
  @Column({
    nullable: false,
    type: Boolean,
    default: false,
  })
  isEnabled: boolean;

  @Column({
    nullable: false,
    type: String,
  })
  platformKey: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  company: CompanyEntity;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
