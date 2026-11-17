import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { MunshiCashService } from './munshi-cash.service';

// Expenses: what the business spends on. A paid expense posts an account row,
// an unpaid bill posts when it is paid, a shop credit posts to the shop's
// khata. The munshi's petty cash is a cash account of its own.
@Module({
  imports: [LedgerEntriesModule, ApprovalsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, MunshiCashService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
