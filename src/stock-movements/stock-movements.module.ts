import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockService } from './stock.service';
import { StockMovementEntity } from './infrastructure/persistence/relational/entities/stock-movement.entity';

// The stock movement engine: append-only rows, on-hand always calculated.
@Module({
  imports: [TypeOrmModule.forFeature([StockMovementEntity])],
  providers: [StockService],
  exports: [StockService, TypeOrmModule],
})
export class StockMovementsModule {}
