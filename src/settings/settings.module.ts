import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogService } from './catalog.service';
import { FactoriesService } from './factories.service';
import { CatalogItemEntity } from './infrastructure/persistence/relational/entities/catalog-item.entity';
import { FactoryEntity } from './infrastructure/persistence/relational/entities/factory.entity';
import { MachineEntity } from './infrastructure/persistence/relational/entities/machine.entity';
import { WorkerRateEntity } from './infrastructure/persistence/relational/entities/worker-rate.entity';
import { MachinesService } from './machines.service';
import { PieceSizesService } from './piece-sizes.service';
import { PieceSizeEntity } from './infrastructure/persistence/relational/entities/piece-size.entity';
import { SettingsController } from './settings.controller';
import { WorkerRatesService } from './worker-rates.service';

// The master lists in Settings: factories, machines, soot sizes, counter
// widths, expense categories and the worker rate card. Later modules read a
// row by id through these services.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FactoryEntity,
      MachineEntity,
      CatalogItemEntity,
      WorkerRateEntity,
      PieceSizeEntity,
    ]),
  ],
  controllers: [SettingsController],
  providers: [
    FactoriesService,
    MachinesService,
    CatalogService,
    WorkerRatesService,
    PieceSizesService,
  ],
  exports: [
    FactoriesService,
    MachinesService,
    CatalogService,
    WorkerRatesService,
    PieceSizesService,
    TypeOrmModule,
  ],
})
export class SettingsModule {}
