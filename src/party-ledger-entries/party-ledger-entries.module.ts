import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartyLedgerEntryEntity } from './infrastructure/persistence/relational/entities/party-ledger-entry.entity';

// Append-only party khata rows (supplier, customer, worker, shop).
@Module({
  imports: [TypeOrmModule.forFeature([PartyLedgerEntryEntity])],
  exports: [TypeOrmModule],
})
export class PartyLedgerEntriesModule {}
