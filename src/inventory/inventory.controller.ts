import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompanyAuth } from '../tenancy/decorators/company-auth.decorator';
import { Permissions } from '../tenancy/decorators/permissions.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import {
  CreateStockEntryDto,
  ListEntriesQueryDto,
  RejectEntryDto,
  SetAlertDto,
  StockQueryDto,
} from './dto/inventory.dto';
import { StockEntriesService } from './stock-entries.service';
import { StockViewService } from './stock-view.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// What is on hand and how it got there. Every route is scoped to the company in
// the caller's token. Looking needs inventory.view; setting a "running low"
// level needs purchasing.create.
@ApiTags('Inventory')
@CompanyAuth()
@Controller({ path: 'stock', version: '1' })
export class StockController {
  constructor(private readonly view: StockViewService) {}

  @Get()
  @Permissions('inventory.view')
  list(@Tenant() tenant: TenantContext, @Query() query: StockQueryDto) {
    return this.view.list(tenant, query);
  }

  // Every movement of one item, oldest first, with the running balance.
  @Get('history')
  @Permissions('inventory.view')
  history(@Tenant() tenant: TenantContext, @Query() query: StockQueryDto) {
    return this.view.history(tenant, query);
  }

  @Put('alerts')
  @Permissions('purchasing.create')
  setAlert(@Tenant() tenant: TenantContext, @Body() dto: SetAlertDto) {
    return this.view.setAlert(tenant, dto);
  }
}

// Opening stock, adjustments and transfers: the only way to change stock
// outside production and sales. Entering needs purchasing.create (a Munshi's
// wait for approval while it is on), deciding needs purchasing.approve.
@ApiTags('Inventory')
@CompanyAuth()
@Controller({ path: 'stock-entries', version: '1' })
export class StockEntriesController {
  constructor(private readonly entries: StockEntriesService) {}

  @Get()
  @Permissions('inventory.view')
  list(@Tenant() tenant: TenantContext, @Query() query: ListEntriesQueryDto) {
    return this.entries.list(tenant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('purchasing.create')
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateStockEntryDto) {
    return this.entries.create(tenant, dto);
  }

  @Get(':id')
  @Permissions('inventory.view')
  get(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.entries.get(tenant, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  approve(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.entries.approve(tenant, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  reject(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: RejectEntryDto,
  ) {
    return this.entries.reject(tenant, id, dto.reason);
  }
}
