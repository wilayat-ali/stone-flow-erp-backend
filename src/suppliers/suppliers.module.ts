import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { SupplierEntity } from './infrastructure/persistence/relational/entities/supplier.entity';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

// Suppliers and their khata (the party ledger, partyType 'supplier'). Later
// modules (purchases, payments, expenses) post their rows through the ledger
// engine and read a supplier through SuppliersService.
@Module({
  imports: [TypeOrmModule.forFeature([SupplierEntity]), LedgerEntriesModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService, TypeOrmModule],
})
export class SuppliersModule {}
