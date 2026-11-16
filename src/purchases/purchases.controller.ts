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
import {
  CreatePurchaseDto,
  ListPurchasesQueryDto,
  ReasonDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';
import { PurchasesService } from './purchases.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Every route is scoped to the company in the caller's token; a company id is
// never read from the URL or body. Looking needs purchasing.view, entering
// trucks purchasing.create (a Munshi's wait for approval while it is on),
// and approving, rejecting, cancelling or editing after approval
// purchasing.approve.
@ApiTags('Purchases')
@CompanyAuth()
@Controller({ path: 'purchases', version: '1' })
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @Permissions('purchasing.view')
  list(@Tenant() tenant: TenantContext, @Query() query: ListPurchasesQueryDto) {
    return this.purchases.list(tenant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('purchasing.create')
  create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseDto) {
    return this.purchases.create(tenant, dto);
  }

  @Get(':id')
  @Permissions('purchasing.view')
  get(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.purchases.get(tenant, id);
  }

  // Anyone who enters trucks may fix a pending one; the service limits edits
  // after approval to people who can approve.
  @Patch(':id')
  @Permissions('purchasing.create', 'purchasing.approve')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchases.update(tenant, id, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  approve(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.purchases.approve(tenant, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  reject(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.purchases.reject(tenant, id, dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('purchasing.approve')
  cancel(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.purchases.cancel(tenant, id, dto.reason);
  }
}
