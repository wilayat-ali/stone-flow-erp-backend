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
import { CompanyAuth } from '../tenancy/decorators/company-auth.decorator';
import { Permissions } from '../tenancy/decorators/permissions.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import { CuttingJobsService } from './cutting-jobs.service';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  FinishJobDto,
  ListCustomersQueryDto,
  ListJobsQueryDto,
  ReceiveJobDto,
  SendJobDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Every route is scoped to the company in the caller's token; a company id is
// never read from the URL or body. Seeing needs customers.view, adding
// customers.create, editing customers.edit. An opening balance is only set by
// someone with customers.editOpening (checked in the service).
@ApiTags('Customers')
@CompanyAuth()
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Permissions('customers.view')
  list(@Tenant() tenant: TenantContext, @Query() query: ListCustomersQueryDto) {
    return this.customers.list(tenant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('customers.create')
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateCustomerDto) {
    return this.customers.create(tenant, dto);
  }

  @Get(':id')
  @Permissions('customers.view')
  get(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.customers.get(tenant, id);
  }

  @Get(':id/khata')
  @Permissions('customers.view')
  khata(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.customers.khata(tenant, id);
  }

  @Patch(':id')
  @Permissions('customers.edit')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(tenant, id, dto);
  }
}

// A customer's own truck being cut: seeing the jobs needs production.view,
// moving one production.operate.
@ApiTags('Cutting jobs')
@CompanyAuth()
@Controller({ path: 'cutting-jobs', version: '1' })
export class CuttingJobsController {
  constructor(private readonly jobs: CuttingJobsService) {}

  @Get()
  @Permissions('production.view')
  list(@Tenant() tenant: TenantContext, @Query() query: ListJobsQueryDto) {
    return this.jobs.list(tenant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('production.operate')
  receive(@Tenant() tenant: TenantContext, @Body() dto: ReceiveJobDto) {
    return this.jobs.receive(tenant, dto);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Permissions('production.operate')
  send(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: SendJobDto,
  ) {
    return this.jobs.send(tenant, id, dto);
  }

  @Post(':id/finish')
  @HttpCode(HttpStatus.OK)
  @Permissions('production.operate')
  finish(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: FinishJobDto,
  ) {
    return this.jobs.finish(tenant, id, dto);
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  @Permissions('production.operate')
  deliver(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.jobs.deliver(tenant, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('production.operate')
  cancel(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.jobs.cancel(tenant, id);
  }
}
