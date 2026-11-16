import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerService } from './ledger.service';
import { LedgerEntryEntity } from './infrastructure/persistence/relational/entities/ledger-entry.entity';

// The money ledger engine: append-only rows, balances always calculated.
@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntryEntity])],
  providers: [LedgerService],
  exports: [LedgerService, TypeOrmModule],
})
export class LedgerEntriesModule {}
