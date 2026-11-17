import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalsModule } from '../approvals/approvals.module';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { SettingsModule } from '../settings/settings.module';
import { WorkerEntity } from './infrastructure/persistence/relational/entities/worker.entity';
import { WorkEntriesService } from './work-entries.service';
import { WorkerDaysService } from './worker-days.service';
import { WorkerPaymentsService } from './worker-payments.service';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';

// Workers and their khata (the party ledger, partyType 'worker'). Production
// pays a worker through WorkEntriesService; the register, attendance and
// payments come with the rest of Workers.
@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerEntity]),
    LedgerEntriesModule,
    ApprovalsModule,
    SettingsModule,
  ],
  controllers: [WorkersController],
  providers: [
    WorkersService,
    WorkEntriesService,
    WorkerDaysService,
    WorkerPaymentsService,
  ],
  exports: [
    WorkersService,
    WorkEntriesService,
    WorkerPaymentsService,
    TypeOrmModule,
  ],
})
export class WorkersModule {}
