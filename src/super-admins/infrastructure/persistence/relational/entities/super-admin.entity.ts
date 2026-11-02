import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'super_admin',
})
export class SuperAdminEntity extends EntityRelationalHelper {
  @Column({
    nullable: true,
    type: Date,
  })
  lastLoginAt?: Date | null;

  @Column({
    nullable: false,
    type: String,
    default: 'active',
  })
  status: string;

  @Column({
    nullable: false,
    type: String,
  })
  role: string;

  @Column({
    nullable: false,
    type: String,
  })
  passwordHash: string;

  @Column({
    nullable: false,
    type: String,
    unique: true,
  })
  email: string;

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
