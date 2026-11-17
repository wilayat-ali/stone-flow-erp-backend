import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';
import { FactoryEntity } from '../../../../../settings/infrastructure/persistence/relational/entities/factory.entity';

import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { bigintTransformer } from '../../../../../utils/transformers/bigint.transformer';
import { decimalTransformer } from '../../../../../utils/transformers/decimal.transformer';

// A person who is paid for work: a thekadar per ton, a section maker, resizer
// or polisher per sq.ft, a helper per day or a staff member a salary. Never
// deleted: a worker who left is made inactive and keeps their khata (the party
// ledger, partyType 'worker').
@Entity({ name: 'worker' })
@Check('CHK_worker_pay_type', `"payType" IN ('ton', 'sqft', 'day', 'month')`)
@Check('CHK_worker_rate', `"rate" >= 0`)
export class WorkerEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_worker' })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_worker_company' })
  company?: CompanyEntity;

  @ManyToOne(() => FactoryEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_worker_factory' })
  factory: FactoryEntity;

  @Column({ nullable: false, type: String })
  name: string;

  @Column({ nullable: false, type: String, default: '' })
  phone: string;

  @Column({ nullable: false, type: String, default: '' })
  jobTitle: string;

  @Column({ nullable: false, type: String })
  payType: string;

  // PKR per ton, per sq.ft, per day or per month. A sq.ft worker with 0 is
  // paid by the job rate card in Settings.
  @Column({
    nullable: false,
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  rate: number;

  // The rate-card job of a sq.ft worker, e.g. "Polisher".
  @Column({ nullable: false, type: String, default: '' })
  defaultJob: string;

  // What we already owed them (positive) or they owed us (negative) before
  // StoneFlow.
  @Column({
    nullable: false,
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  openingBalance: number;

  @Column({ nullable: false, type: 'date' })
  joinedOn: string;

  @Column({ nullable: false, type: Boolean, default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
