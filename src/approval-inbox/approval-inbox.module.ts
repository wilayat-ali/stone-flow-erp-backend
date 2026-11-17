import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { CashBankModule } from '../cash-bank/cash-bank.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';
import { WorkersModule } from '../workers/workers.module';
import { ApprovalInboxController } from './approval-inbox.controller';
import { ApprovalInboxService } from './approval-inbox.service';

// The approvals inbox: one list over every module, and one decision path that
// hands the approve or reject to the module that owns the record.
@Module({
  imports: [
    ApprovalsModule,
    CashBankModule,
    ExpensesModule,
    InventoryModule,
    PurchasesModule,
    SupplierPaymentsModule,
    WorkersModule,
  ],
  controllers: [ApprovalInboxController],
  providers: [ApprovalInboxService],
})
export class ApprovalInboxModule {}
