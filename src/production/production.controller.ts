import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompanyAuth } from '../tenancy/decorators/company-auth.decorator';
import { Permissions } from '../tenancy/decorators/permissions.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import { CuttingService } from './cutting.service';
import {
  CreateProductionEntryDto,
  FinishCuttingDto,
  ListProductionEntriesQueryDto,
  SendToMachineDto,
  StartCuttingDto,
} from './dto/production.dto';
import { ProductionEntriesService } from './production-entries.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Every route is scoped to the company in the caller's token; a company id is
// never read from the URL or body. Looking needs production.view, moving a
// truck or posting a step production.operate (a Munshi has it), and taking a
// step back production.reverse.
@ApiTags('Production')
@CompanyAuth()
@Controller({ path: 'production', version: '1' })
export class ProductionController {
  constructor(
    private readonly cutting: CuttingService,
    private readonly entries: ProductionEntriesService,
  ) {}

  @Get('workers')
  @Permissions('production.view')
  workers(@Tenant() tenant: TenantContext) {
    return this.entries.sqftWorkers(tenant);
  }

  @Get('entries')
  @Permissions('production.view')
  list(
    @Tenant() tenant: TenantContext,
    @Query() query: ListProductionEntriesQueryDto,
  ) {
    return this.entries.list(tenant, query);
  }

  @Get('entries/:id')
  @Permissions('production.view')
  get(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.entries.get(tenant, id);
  }

  @Post('entries')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('production.operate')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateProductionEntryDto,
  ) {
    return this.entries.create(tenant, dto);
  }

  @Post('entries/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @Permissions('production.reverse')
  reverse(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.entries.reverse(tenant, id);
  }

  @Post('trucks/:id/send')
  @HttpCode(HttpStatus.OK)
  @Permissions('production.operate')
  send(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: SendToMachineDto,
  ) {
    return this.cutting.send(tenant, id, dto);
  }

  @Post('trucks/:id/start')
  @HttpCode(HttpStatus.OK)
  @Permissions('production.operate')
  start(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: StartCuttingDto,
  ) {
    return this.cutting.start(tenant, id, dto);
  }

  @Post('trucks/:id/finish')
  @HttpCode(HttpStatus.OK)
  @Permissions('production.operate')
  finish(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: FinishCuttingDto,
  ) {
    return this.cutting.finish(tenant, id, dto);
  }
}
