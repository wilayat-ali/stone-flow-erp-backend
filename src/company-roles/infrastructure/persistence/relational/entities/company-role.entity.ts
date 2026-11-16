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

@Unique(['company', 'key'])
@Entity({
  name: 'company_role',
})
export class CompanyRoleEntity extends EntityRelationalHelper {
  @Column({
    nullable: false,
    type: Boolean,
    default: false,
  })
  isSystem: boolean;

  @Column({
    nullable: false,
    type: String,
  })
  key: string;

  @Column({
    nullable: false,
    type: String,
  })
  name: string;

  @Column({
    nullable: false,
    type: String,
    default: '',
  })
  description: string;

  @Column({
    nullable: false,
    type: 'jsonb',
    default: () => "'[]'",
  })
  permissions: string[];

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  company: CompanyEntity;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
