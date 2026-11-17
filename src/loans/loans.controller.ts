import {
  Body,
  Controller,
  Delete,
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
import { GiveLoanDto, InstalmentChangeDto } from './dto/loan.dto';
import { LoansService } from './loans.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Loans to workers. Seeing them needs expenses.view; giving a loan and changing
// or resetting a month's instalment need expenses.manage. A closed month cannot
// be changed.
@ApiTags('Loans')
@CompanyAuth()
@Controller({ path: 'loans', version: '1' })
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get()
  @Permissions('expenses.view')
  list(@Tenant() tenant: TenantContext, @Query('workerId') workerId?: string) {
    return this.loans.list(tenant, workerId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('expenses.manage')
  give(@Tenant() tenant: TenantContext, @Body() dto: GiveLoanDto) {
    return this.loans.give(tenant, dto);
  }

  @Put(':id/months/:month')
  @HttpCode(HttpStatus.OK)
  @Permissions('expenses.manage')
  change(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Param('month') month: string,
    @Body() dto: InstalmentChangeDto,
  ) {
    return this.loans.change(tenant, id, month, dto);
  }

  @Delete(':id/months/:month')
  @Permissions('expenses.manage')
  reset(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Param('month') month: string,
  ) {
    return this.loans.reset(tenant, id, month);
  }
}
