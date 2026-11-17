import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { CashBankAccountsService } from './cash-bank-accounts.service';
import { CashBankEntriesService } from './cash-bank-entries.service';
import { CashBankController } from './cash-bank.controller';

// Core (always on): accounts, transfers, deposits, other payment/receipt, cash
// count and the statement, built on the ledger and approval engines.
@Module({
  imports: [LedgerEntriesModule, ApprovalsModule],
  controllers: [CashBankController],
  providers: [CashBankAccountsService, CashBankEntriesService],
  exports: [CashBankAccountsService, CashBankEntriesService],
})
export class CashBankModule {}
