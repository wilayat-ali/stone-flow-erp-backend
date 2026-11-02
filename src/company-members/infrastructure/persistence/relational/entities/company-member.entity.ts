import { CompanyRoleEntity } from '../../../../../company-roles/infrastructure/persistence/relational/entities/company-role.entity';

import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';

import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';

import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  Column,
  Unique,
  Index,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Unique(['company', 'user'])
@Entity({
  name: 'company_member',
})
export class CompanyMemberEntity extends EntityRelationalHelper {
  @Column({
    nullable: true,
    type: Date,
  })
  joinedAt?: Date | null;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: true })
  invitedByMember?: CompanyMemberEntity | null;

  @Column({
    nullable: false,
    type: String,
    default: 'invited',
  })
  status: string;

  @ManyToOne(() => CompanyRoleEntity, { eager: false, nullable: false })
  role: CompanyRoleEntity;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @Index()
  user: UserEntity;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  company: CompanyEntity;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
