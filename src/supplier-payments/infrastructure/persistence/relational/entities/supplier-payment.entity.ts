import { AccountEntity } from '../../../../../accounts/infrastructure/persistence/relational/entities/account.entity';
import { CompanyMemberEntity } from '../../../../../company-members/infrastructure/persistence/relational/entities/company-member.entity';
import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';
import { SupplierEntity } from '../../../../../suppliers/infrastructure/persistence/relational/entities/supplier.entity';

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

// Money paid to a supplier (rules §6). A Munshi's payment waits as 'pending'
// while approval is on and has no effect. Cash and bank transfers leave the
// account when the payment counts; a cheque is only recorded when it is given
// and leaves the bank when it clears (see SupplierChequeEntity). What it does
// to the money lives in the ledgers, never here.
@Entity({ name: 'supplier_payment' })
@Check(
  'CHK_supplier_payment_method',
  `"method" IN ('cash', 'bank_transfer', 'cheque')`,
)
@Check(
  'CHK_supplier_payment_status',
  `"status" IN ('pending', 'confirmed', 'reversed')`,
)
@Check('CHK_supplier_payment_amount', `"amount" > 0`)
@Index('UQ_supplier_payment_voucher', ['company', 'voucherSeq'], {
  unique: true,
})
@Index('IDX_supplier_payment_supplier', ['company', 'supplier', 'date'])
export class SupplierPaymentEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_supplier_payment',
  })
  id: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_payment_company' })
  company?: CompanyEntity;

  // PV-0001, PV-0002 ... continues per company and never repeats.
  @Column({ nullable: false, type: 'int' })
  voucherSeq: number;

  // Business day (YYYY-MM-DD) kept as a string so no timezone can shift it.
  @Column({ nullable: false, type: 'date' })
  date: string;

  @ManyToOne(() => SupplierEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_payment_supplier' })
  supplier: SupplierEntity;

  @Column({ nullable: false, type: String })
  method: string;

  // The cash account it is paid from, or the bank account (transfer or cheque).
  @ManyToOne(() => AccountEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_payment_account' })
  account: AccountEntity;

  @Column({ nullable: false, type: 'bigint', transformer: bigintTransformer })
  amount: number;

  // Bank transfer reference.
  @Column({ nullable: false, type: String, default: '' })
  reference: string;

  // Trucks this payment was made for; the rest goes to the oldest unpaid ones.
  @Column({ nullable: false, type: 'uuid', array: true, default: () => "'{}'" })
  forPurchaseIds: string[];

  @Column({ nullable: false, type: String })
  status: string;

  @Column({ nullable: false, type: String, default: '' })
  note: string;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: false })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_payment_created_by' })
  createdBy: CompanyMemberEntity;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: true })
  @JoinColumn({ foreignKeyConstraintName: 'FK_supplier_payment_approved_by' })
  approvedBy?: CompanyMemberEntity | null;

  // The approval this payment went through (engine record), to decide it later.
  @Column({ nullable: true, type: 'uuid' })
  approvalId?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
