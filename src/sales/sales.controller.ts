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
import { BillsService } from './bills.service';
import { CustomerPaymentsService } from './customer-payments.service';
import {
  BounceChequeDto,
  ClearChequeDto,
  CreateBillDto,
  CreateOrderDto,
  GiveStoneDto,
  ListPaymentsQueryDto,
  ReasonDto,
  ReceivePaymentDto,
  UpdateBillDto,
} from './dto/sales.dto';
import { OrdersService } from './orders.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Every route is scoped to the company in the caller's token; a company id is
// never read from the URL or body. Looking needs sales.view, making a bill,
// giving stone or taking a payment sales.create, and changing what was done
// (editing or cancelling a bill, reversing a payment, deciding a cheque)
// sales.manage.
@ApiTags('Sales')
@CompanyAuth()
@Controller({ path: 'bills', version: '1' })
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  @Permissions('sales.view')
  list(@Tenant() tenant: TenantContext) {
    return this.bills.list(tenant);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('sales.create')
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateBillDto) {
    return this.bills.create(tenant, dto);
  }

  @Get(':id')
  @Permissions('sales.view')
  get(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.bills.get(tenant, id);
  }

  @Patch(':id')
  @Permissions('sales.manage')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateBillDto,
  ) {
    return this.bills.update(tenant, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('sales.manage')
  cancel(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.bills.cancel(tenant, id, dto.reason);
  }

  @Post(':id/collections')
  @HttpCode(HttpStatus.OK)
  @Permissions('sales.create')
  give(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: GiveStoneDto,
  ) {
    return this.bills.give(tenant, id, dto);
  }
}

@ApiTags('Sales')
@CompanyAuth()
@Controller({ path: 'sales-orders', version: '1' })
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Permissions('sales.view')
  list(@Tenant() tenant: TenantContext) {
    return this.orders.list(tenant);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('sales.create')
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateOrderDto) {
    return this.orders.create(tenant, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('sales.manage')
  cancel(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.orders.cancel(tenant, id);
  }
}

@ApiTags('Sales')
@CompanyAuth()
@Controller({ path: 'customer-payments', version: '1' })
export class CustomerPaymentsController {
  constructor(private readonly payments: CustomerPaymentsService) {}

  @Get()
  @Permissions('sales.view')
  list(@Tenant() tenant: TenantContext, @Query() query: ListPaymentsQueryDto) {
    return this.payments.list(tenant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('sales.create')
  receive(@Tenant() tenant: TenantContext, @Body() dto: ReceivePaymentDto) {
    return this.payments.receive(tenant, dto);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @Permissions('sales.manage')
  reverse(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.payments.reverse(tenant, id);
  }
}

@ApiTags('Sales')
@CompanyAuth()
@Controller({ path: 'customer-cheques', version: '1' })
export class CustomerChequesController {
  constructor(private readonly payments: CustomerPaymentsService) {}

  @Get()
  @Permissions('sales.view')
  list(@Tenant() tenant: TenantContext) {
    return this.payments.cheques(tenant);
  }

  @Post(':id/clear')
  @HttpCode(HttpStatus.OK)
  @Permissions('sales.manage')
  clear(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: ClearChequeDto,
  ) {
    return this.payments.clear(tenant, id, dto);
  }

  @Post(':id/bounce')
  @HttpCode(HttpStatus.OK)
  @Permissions('sales.manage')
  bounce(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: BounceChequeDto,
  ) {
    return this.payments.bounce(tenant, id, dto);
  }
}
