import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompanyAuth } from '../tenancy/decorators/company-auth.decorator';
import { Permissions } from '../tenancy/decorators/permissions.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import { MonthEndService } from './month-end.service';

// The month-end sheet. Seeing it needs expenses.view; closing a month needs
// monthEnd.close and reopening one monthEnd.reopen (only partners and the owner
// have it by default).
@ApiTags('Month end')
@CompanyAuth()
@Controller({ path: 'months', version: '1' })
export class MonthEndController {
  constructor(private readonly months: MonthEndService) {}

  @Get('log')
  @Permissions('expenses.view')
  log(@Tenant() tenant: TenantContext) {
    return this.months.log(tenant);
  }

  @Get(':month/sheet')
  @Permissions('expenses.view')
  sheet(@Tenant() tenant: TenantContext, @Param('month') month: string) {
    return this.months.sheet(tenant, month);
  }

  @Get(':month/preview')
  @Permissions('expenses.view')
  preview(@Tenant() tenant: TenantContext, @Param('month') month: string) {
    return this.months.preview(tenant, month);
  }

  @Post(':month/close')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('monthEnd.close')
  close(@Tenant() tenant: TenantContext, @Param('month') month: string) {
    return this.months.close(tenant, month);
  }

  @Post(':month/reopen')
  @HttpCode(HttpStatus.OK)
  @Permissions('monthEnd.reopen')
  async reopen(@Tenant() tenant: TenantContext, @Param('month') month: string) {
    await this.months.reopen(tenant, month);

    return { ok: true };
  }
}
