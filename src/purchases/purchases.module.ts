import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalsModule } from '../approvals/approvals.module';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { SettingsModule } from '../settings/settings.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PurchaseEntity } from './infrastructure/persistence/relational/entities/purchase.entity';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

// Truck purchases: the purchase row, its approval, the supplier charge and the
// factory's mark. Payments (#4) and Production (#6) build on it.
@Module({
  imports: [
    TypeOrmModule.forFeature([PurchaseEntity]),
    LedgerEntriesModule,
    ApprovalsModule,
    SuppliersModule,
    SettingsModule,
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService, TypeOrmModule],
})
export class PurchasesModule {}
