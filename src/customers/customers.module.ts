import { Module } from '@nestjs/common';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { WorkersModule } from '../workers/workers.module';
import { CuttingJobsService } from './cutting-jobs.service';
import {
  CuttingJobsController,
  CustomersController,
} from './customers.controller';
import { CustomersService } from './customers.service';

// Customers and their khata (the party ledger, partyType 'customer'), and the
// cutting jobs that charge it. Sales bills and customer payments (#8) post to
// the same khata through the ledger engine.
@Module({
  imports: [LedgerEntriesModule, WorkersModule],
  controllers: [CustomersController, CuttingJobsController],
  providers: [CustomersService, CuttingJobsService],
  exports: [CustomersService],
})
export class CustomersModule {}
