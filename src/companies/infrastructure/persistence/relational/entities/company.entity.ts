import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';

import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
  ManyToOne,
  Index,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'company',
})
export class CompanyEntity extends EntityRelationalHelper {
  @Column({
    nullable: true,
    type: String,
  })
  theme?: string | null;

  @Column({
    nullable: false,
    type: String,
    default: 'PKR',
  })
  currency: string;

  @Column({
    nullable: false,
    type: String,
    default: 'en_ur',
  })
  parchiLanguage: string;

  @Column({
    nullable: false,
    type: Boolean,
    default: true,
  })
  approvalRequired: boolean;

  @Column({
    nullable: true,
    type: String,
  })
  ntn?: string | null;

  @Column({
    nullable: true,
    type: String,
  })
  address?: string | null;

  @Column({
    nullable: true,
    type: String,
  })
  phone?: string | null;

  @Index()
  @Column({
    nullable: false,
    type: String,
    default: 'active',
  })
  status: string;

  @Column({
    nullable: false,
    type: String,
    unique: true,
  })
  slug: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  ownerUser: UserEntity;

  @Column({
    nullable: false,
    type: String,
  })
  name: string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
