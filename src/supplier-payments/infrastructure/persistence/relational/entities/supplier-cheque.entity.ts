import { AccountEntity } from '../../../../../accounts/infrastructure/persistence/relational/entities/account.entity';
import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';
import { SupplierEntity } from '../../../../../suppliers/infrastructure/persistence/relational/entities/supplier.entity';
import { SupplierPaymentEntity } from './supplier-payment.entity';

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
import { bigintTransformer } from '../../../../../utils/transformers/bigint.transformer';

// A cheque given to a supplier. The supplier is credited when it is given; the
// money leaves the bank only when it clears. If it bounces or comes back
// unused, the amount is owed again.
@Entity({ name: 'supplier_cheque' })
@Check(
  'CHK_supplier_cheque_status',
  `"status" IN ('issued', 'cleared', 'bounced', 'cancelled')`,
)
@Check('CHK_supplier_cheque_amount', `"amount" > 0 AND "charge" >= 0`)
// A cheque number is used once per bank account, unless it was cancelled.
@Index('UQ_supplier_cheque_no', ['company', 'account', 'no'], {
  unique: true,
  where: `"status" <> 'cancelled'`,
})
@Index('IDX_supplier_cheque_supplier', ['company', 'supplier', 'status'])
export class SupplierChequeEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_supplier_cheque',
  })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_cheque_company' })
  company?: CompanyEntity;

  @Column({ nullable: false, type: String })
  no: string;

  @ManyToOne(() => AccountEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_cheque_account' })
  account: AccountEntity;

  @ManyToOne(() => SupplierEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_cheque_supplier' })
  supplier: SupplierEntity;

  @Column({ nullable: false, type: 'bigint', transformer: bigintTransformer })
  amount: number;

  // The day it was handed over.
  @Column({ nullable: false, type: 'date' })
  issuedOn: string;

  // The date written on the cheque.
  @Column({ nullable: false, type: 'date' })
  chequeDate: string;

  @Column({ nullable: false, type: String })
  status: string;

  // The day it cleared, bounced or came back.
  @Column({ nullable: true, type: 'date' })
  statusDate?: string | null;

  @Column({ nullable: true, type: String })
  reason?: string | null;

  // Bank charge when it bounced, in PKR.
  @Column({
    nullable: false,
    type: 'bigint',
    transformer: bigintTransformer,
    default: 0,
  })
  charge: number;

  @ManyToOne(() => SupplierPaymentEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_cheque_payment' })
  payment: SupplierPaymentEntity;

  // The payment that replaced this cheque after it bounced.
  @ManyToOne(() => SupplierPaymentEntity, { eager: false, nullable: true })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_cheque_replaced_by' })
  replacedByPayment?: SupplierPaymentEntity | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
