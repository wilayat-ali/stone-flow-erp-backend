import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerEntriesModule } from '../ledger-entries/ledger-entries.module';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { BillsService } from './bills.service';
import { CustomerPaymentsService } from './customer-payments.service';
import { OrdersService } from './orders.service';
import { SaleLinesService } from './sale-lines.service';
import {
  BillsController,
  CustomerChequesController,
  CustomerPaymentsController,
  OrdersController,
} from './sales.controller';

// Sales: bills, the stone collected on them, orders, and the money received
// from customers (with cheques). Bills charge the customer's khata, payments
// credit it, collections move stock, and cash and bank receipts post to the
// accounts through the ledger engine.
@Module({
  imports: [
    CustomersModule,
    InventoryModule,
    LedgerEntriesModule,
    StockMovementsModule,
  ],
  controllers: [
    BillsController,
    OrdersController,
    CustomerPaymentsController,
    CustomerChequesController,
  ],
  providers: [
    SaleLinesService,
    BillsService,
    OrdersService,
    CustomerPaymentsService,
  ],
})
export class SalesModule {}
