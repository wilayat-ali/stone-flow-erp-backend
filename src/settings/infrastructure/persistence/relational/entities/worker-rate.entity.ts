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
import { decimalTransformer } from '../../../../../utils/transformers/decimal.transformer';

// The rate card: a job or role, how it is paid, and the rate in PKR.
@Entity({ name: 'worker_rate' })
@Check(
  'CHK_worker_rate_pay_type',
  `"payType" IN ('perTon', 'perSqft', 'daily', 'monthly')`,
)
@Check('CHK_worker_rate_rate', `"rate" > 0`)
@Index('IDX_worker_rate_company', ['company'])
export class WorkerRateEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_worker_rate',
  })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_worker_rate_company' })
  company?: CompanyEntity;

  // Job or role, e.g. "Thekadar - Vertical Cutting".
  @Column({ nullable: false, type: String })
  name: string;

  @Column({ nullable: false, type: String })
  payType: string;

  @Column({
    nullable: false,
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: decimalTransformer,
  })
  rate: number;

  @Column({ nullable: false, type: Boolean, default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
