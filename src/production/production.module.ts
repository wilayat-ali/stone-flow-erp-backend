import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { WorkersModule } from '../workers/workers.module';
import { CuttingService } from './cutting.service';
import { ProductionEntriesService } from './production-entries.service';
import { ProductionController } from './production.controller';

// Production: trucks moving through cutting, then the steps after it (count,
// section, counter, resize, polish). Stock changes go through the stock
// engine, pay through the workers' khata and the cutting factory's supplier
// khata.
@Module({
  imports: [
    PurchasesModule,
    WorkersModule,
    InventoryModule,
    StockMovementsModule,
    LedgerEntriesModule,
  ],
  controllers: [ProductionController],
  providers: [CuttingService, ProductionEntriesService],
})
export class ProductionModule {}
