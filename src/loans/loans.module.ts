import { Module } from '@nestjs/common';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

// Loans to workers and their month-by-month schedule. Closing a month (in
// MonthEndModule) deducts the instalments from pay.
@Module({
  imports: [LedgerEntriesModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
