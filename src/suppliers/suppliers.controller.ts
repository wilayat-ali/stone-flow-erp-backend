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
  CreateSupplierDto,
  ListSuppliersQueryDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { SuppliersService } from './suppliers.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Every route is scoped to the company in the caller's token; a company id is
// never read from the URL or body. Seeing needs suppliers.view, adding
// suppliers.create (a Munshi has it), editing or deactivating suppliers.manage.
@ApiTags('Suppliers')
@CompanyAuth()
@Controller({ path: 'suppliers', version: '1' })
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @Permissions('suppliers.view')
  list(@Tenant() tenant: TenantContext, @Query() query: ListSuppliersQueryDto) {
    return this.suppliers.list(tenant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('suppliers.create')
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(tenant, dto);
  }

  @Get(':id')
  @Permissions('suppliers.view')
  get(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.suppliers.get(tenant, id);
  }

  @Get(':id/khata')
  @Permissions('suppliers.view')
  khata(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.suppliers.khata(tenant, id);
  }

  @Patch(':id')
  @Permissions('suppliers.manage')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(tenant, id, dto);
  }
}
