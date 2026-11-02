import { CompanyMemberEntity } from '../../../../../company-members/infrastructure/persistence/relational/entities/company-member.entity';

import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';

import { CompanyRoleEntity } from '../../../../../company-roles/infrastructure/persistence/relational/entities/company-role.entity';

import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';

import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  Column,
  Index,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Index(['company', 'phone'], {
  unique: true,
  where: `"status" = 'pending' AND "phone" IS NOT NULL`,
})
@Index(['company', 'email'], {
  unique: true,
  where: `"status" = 'pending' AND "email" IS NOT NULL`,
})
@Entity({
  name: 'company_invitation',
})
export class CompanyInvitationEntity extends EntityRelationalHelper {
  @Column({
    nullable: true,
    type: Date,
  })
  acceptedAt?: Date | null;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: true })
  invitedByMember?: CompanyMemberEntity | null;

  @Column({
    nullable: false,
    type: String,
    default: 'pending',
  })
  status: string;

  @Column({
    nullable: false,
    type: Date,
  })
  expiresAt: Date;

  @Column({
    nullable: false,
    type: String,
    unique: true,
  })
  tokenHash: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: true })
  user?: UserEntity | null;

  @ManyToOne(() => CompanyRoleEntity, { eager: false, nullable: true })
  role?: CompanyRoleEntity | null;

  @Column({
    nullable: true,
    type: String,
  })
  email?: string | null;

  @Column({
    nullable: true,
    type: String,
  })
  phone?: string | null;

  @Column({
    nullable: false,
    type: String,
    default: 'invite',
  })
  type: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  company: CompanyEntity;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
