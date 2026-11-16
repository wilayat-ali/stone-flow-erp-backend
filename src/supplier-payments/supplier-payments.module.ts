import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalsModule } from '../approvals/approvals.module';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SupplierChequeEntity } from './infrastructure/persistence/relational/entities/supplier-cheque.entity';
import { SupplierPaymentEntity } from './infrastructure/persistence/relational/entities/supplier-payment.entity';
import { SupplierChequesService } from './supplier-cheques.service';
import {
  SupplierChequesController,
  SupplierPaymentsController,
} from './supplier-payments.controller';
import { SupplierPaymentsService } from './supplier-payments.service';

// Payments to suppliers and the cheques given: the payment row, its approval,
// the money out of the account and the credit in the supplier's khata.
@Module({
  imports: [
    TypeOrmModule.forFeature([SupplierPaymentEntity, SupplierChequeEntity]),
    LedgerEntriesModule,
    ApprovalsModule,
    SuppliersModule,
  ],
  controllers: [SupplierPaymentsController, SupplierChequesController],
  providers: [SupplierPaymentsService, SupplierChequesService],
  exports: [SupplierPaymentsService, SupplierChequesService, TypeOrmModule],
})
export class SupplierPaymentsModule {}
