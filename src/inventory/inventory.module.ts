import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalsModule } from '../approvals/approvals.module';
import { SettingsModule } from '../settings/settings.module';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { StockAlertEntity } from './infrastructure/persistence/relational/entities/stock-alert.entity';
import { StockEntryEntity } from './infrastructure/persistence/relational/entities/stock-entry.entity';
import {
  StockController,
  StockEntriesController,
} from './inventory.controller';
import { StockEntriesService } from './stock-entries.service';
import { StockItemsService } from './stock-items.service';
import { StockViewService } from './stock-view.service';

// Inventory: what is on hand (from the stock engine), the stock entries that
// change it by hand, and the "running low" levels. Production and Sales post to
// the same engine through StockService.
@Module({
  imports: [
    TypeOrmModule.forFeature([StockEntryEntity, StockAlertEntity]),
    StockMovementsModule,
    ApprovalsModule,
    SettingsModule,
  ],
  controllers: [StockController, StockEntriesController],
  providers: [StockEntriesService, StockItemsService, StockViewService],
  exports: [
    StockItemsService,
    StockViewService,
    StockEntriesService,
    TypeOrmModule,
  ],
})
export class InventoryModule {}
