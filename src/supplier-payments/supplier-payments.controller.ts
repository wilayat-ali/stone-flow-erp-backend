import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompanyAuth } from '../tenancy/decorators/company-auth.decorator';
import { Permissions } from '../tenancy/decorators/permissions.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import {
  BounceChequeDto,
  ClearChequeDto,
  CreateSupplierPaymentDto,
  RejectPaymentDto,
} from './dto/supplier-payment.dto';
import { SupplierChequesService } from './supplier-cheques.service';
import { SupplierPaymentsService } from './supplier-payments.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Every route is scoped to the company in the caller's token; a company id is
// never read from the URL or body. Looking needs purchasing.view, paying
// purchasing.create (a Munshi's payment waits for approval while it is on),
// and confirming, rejecting or deciding a cheque purchasing.approve.
@ApiTags('Supplier payments')
@CompanyAuth()
@Controller({ path: 'supplier-payments', version: '1' })
export class SupplierPaymentsController {
  constructor(private readonly payments: SupplierPaymentsService) {}

  @Get()
  @Permissions('purchasing.view')
  list(@Tenant() tenant: TenantContext) {
    return this.payments.list(tenant);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('purchasing.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateSupplierPaymentDto,
  ) {
    return this.payments.create(tenant, dto);
  }

  @Get(':id')
  @Permissions('purchasing.view')
  get(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.payments.get(tenant, id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  confirm(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.payments.confirm(tenant, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  reject(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.payments.reject(tenant, id, dto.reason);
  }
}

@ApiTags('Supplier payments')
@CompanyAuth()
@Controller({ path: 'supplier-cheques', version: '1' })
export class SupplierChequesController {
  constructor(private readonly cheques: SupplierChequesService) {}

  @Get()
  @Permissions('purchasing.view')
  list(@Tenant() tenant: TenantContext) {
    return this.cheques.list(tenant);
  }

  @Post(':id/clear')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  clear(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: ClearChequeDto,
  ) {
    return this.cheques.clear(tenant, id, dto.date);
  }

  @Post(':id/bounce')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  bounce(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: BounceChequeDto,
  ) {
    return this.cheques.bounce(tenant, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  cancel(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.cheques.cancel(tenant, id);
  }
}
