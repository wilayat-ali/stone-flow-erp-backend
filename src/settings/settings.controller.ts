import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { notFound } from '../engines/errors';
import { CompanyAuth } from '../tenancy/decorators/company-auth.decorator';
import { Permissions } from '../tenancy/decorators/permissions.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import { CatalogService } from './catalog.service';
import {
  CreateCatalogItemDto,
  CreateFactoryDto,
  CreateMachineDto,
  CreatePieceSizeDto,
  CreateWorkerRateDto,
  ListQueryDto,
  UpdateCatalogItemDto,
  UpdateFactoryDto,
  UpdateMachineDto,
  UpdatePieceSizeDto,
  UpdateWorkerRateDto,
} from './dto/settings.dto';
import { FactoriesService } from './factories.service';
import { MachinesService } from './machines.service';
import { PieceSizesService } from './piece-sizes.service';
import { CATALOG_PATHS, CatalogKind } from './settings.types';
import { WorkerRatesService } from './worker-rates.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

function catalogKind(path: string): CatalogKind {
  const kind = (CATALOG_PATHS as Record<string, CatalogKind>)[path];

  if (!kind) {
    throw notFound('list');
  }

  return kind;
}

// The master lists in Settings. Every route is scoped to the company in the
// caller's token. Anyone in the company may read them (the forms in every
// module need them); adding, editing and hiding rows needs settings.view,
// which is the whole Settings area.
@ApiTags('Settings')
@CompanyAuth()
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(
    private readonly factories: FactoriesService,
    private readonly machines: MachinesService,
    private readonly catalog: CatalogService,
    private readonly rates: WorkerRatesService,
    private readonly pieceSizes: PieceSizesService,
  ) {}

  // ----------------------------------------------------------- factories

  @Get('factories')
  listFactories(@Tenant() tenant: TenantContext, @Query() query: ListQueryDto) {
    return this.factories.list(tenant, query.includeInactive);
  }

  @Post('factories')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('settings.view')
  createFactory(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateFactoryDto,
  ) {
    return this.factories.create(tenant, dto);
  }

  @Patch('factories/:id')
  @Permissions('settings.view')
  updateFactory(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateFactoryDto,
  ) {
    return this.factories.update(tenant, id, dto);
  }

  // ------------------------------------------------------------ machines

  @Get('machines')
  listMachines(@Tenant() tenant: TenantContext, @Query() query: ListQueryDto) {
    return this.machines.list(tenant, query.includeInactive);
  }

  @Post('machines')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('settings.view')
  createMachine(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateMachineDto,
  ) {
    return this.machines.create(tenant, dto);
  }

  @Patch('machines/:id')
  @Permissions('settings.view')
  updateMachine(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateMachineDto,
  ) {
    return this.machines.update(tenant, id, dto);
  }

  // --------------------------------------------------------- worker rates

  @Get('worker-rates')
  listRates(@Tenant() tenant: TenantContext, @Query() query: ListQueryDto) {
    return this.rates.list(tenant, query.includeInactive);
  }

  @Post('worker-rates')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('settings.view')
  createRate(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateWorkerRateDto,
  ) {
    return this.rates.create(tenant, dto);
  }

  @Patch('worker-rates/:id')
  @Permissions('settings.view')
  updateRate(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateWorkerRateDto,
  ) {
    return this.rates.update(tenant, id, dto);
  }

  // ---------------------------------------------------------- piece sizes

  @Get('piece-sizes')
  listPieceSizes(
    @Tenant() tenant: TenantContext,
    @Query() query: ListQueryDto,
  ) {
    return this.pieceSizes.list(tenant, query.includeInactive);
  }

  @Post('piece-sizes')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('settings.view')
  createPieceSize(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreatePieceSizeDto,
  ) {
    return this.pieceSizes.create(tenant, dto);
  }

  @Patch('piece-sizes/:id')
  @Permissions('settings.view')
  updatePieceSize(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdatePieceSizeDto,
  ) {
    return this.pieceSizes.update(tenant, id, dto);
  }

  // ------------------- soot-sizes, counter-widths and expense-categories
  // Keep these last: the other routes above are more specific.

  @Get(':list')
  listCatalog(
    @Tenant() tenant: TenantContext,
    @Param('list') list: string,
    @Query() query: ListQueryDto,
  ) {
    return this.catalog.list(tenant, catalogKind(list), query.includeInactive);
  }

  @Post(':list')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('settings.view')
  createCatalogItem(
    @Tenant() tenant: TenantContext,
    @Param('list') list: string,
    @Body() dto: CreateCatalogItemDto,
  ) {
    return this.catalog.create(tenant, catalogKind(list), dto);
  }

  @Patch(':list/:id')
  @Permissions('settings.view')
  updateCatalogItem(
    @Tenant() tenant: TenantContext,
    @Param('list') list: string,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateCatalogItemDto,
  ) {
    return this.catalog.update(tenant, catalogKind(list), id, dto);
  }
}
