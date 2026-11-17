import { Module } from '@nestjs/common';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { LoansModule } from '../loans/loans.module';
import { MonthEndController } from './month-end.controller';
import { MonthEndService } from './month-end.service';

// The month-end sheet and the close: the salaries and loan instalments that
// are posted to each worker's khata once, and the lock that follows.
@Module({
  imports: [LedgerEntriesModule, LoansModule],
  controllers: [MonthEndController],
  providers: [MonthEndService],
})
export class MonthEndModule {}
