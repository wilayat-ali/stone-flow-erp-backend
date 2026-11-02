import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';

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
  name: 'audit_log',
})
export class AuditLogEntity extends EntityRelationalHelper {
  @Column({
    nullable: true,
    type: 'text',
  })
  metadata?: string | null;

  @Column({
    nullable: true,
    type: String,
  })
  targetId?: string | null;

  @Column({
    nullable: true,
    type: String,
  })
  targetType?: string | null;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: true })
  @Index()
  company?: CompanyEntity | null;

  @Column({
    nullable: false,
    type: String,
  })
  action: string;

  @Column({
    nullable: false,
    type: String,
  })
  actorId: string;

  @Column({
    nullable: false,
    type: String,
  })
  actorType: string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
