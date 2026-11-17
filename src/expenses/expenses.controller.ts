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
import {
  CreateExpenseDto,
  GiveMunshiCashDto,
  ListExpensesQueryDto,
  PayBillDto,
  ReasonDto,
} from './dto/expense.dto';
import { ExpensesService } from './expenses.service';
import { MunshiCashService } from './munshi-cash.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Every route is scoped to the company in the caller's token; a company id is
// never read from the URL or body. Seeing needs expenses.view, recording one
// expenses.create (a munshi has it, and it waits for approval). Approving,
// rejecting, cancelling, paying a bill and giving the munshi cash need
// expenses.manage.
@ApiTags('Expenses')
@CompanyAuth()
@Controller({ path: 'expenses', version: '1' })
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly munshi: MunshiCashService,
  ) {}

  @Get('munshi-cash')
  @Permissions('expenses.view')
  munshiCash(@Tenant() tenant: TenantContext) {
    return this.munshi.summary(tenant);
  }

  @Post('munshi-cash/gives')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('expenses.manage')
  give(@Tenant() tenant: TenantContext, @Body() dto: GiveMunshiCashDto) {
    return this.munshi.give(tenant, dto);
  }

  @Get()
  @Permissions('expenses.view')
  list(@Tenant() tenant: TenantContext, @Query() query: ListExpensesQueryDto) {
    return this.expenses.list(tenant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('expenses.create')
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateExpenseDto) {
    return this.expenses.create(tenant, dto);
  }

  @Get(':id')
  @Permissions('expenses.view')
  get(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.expenses.get(tenant, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('expenses.manage')
  approve(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.expenses.approve(tenant, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('expenses.manage')
  reject(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.expenses.reject(tenant, id, dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('expenses.manage')
  cancel(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.expenses.cancel(tenant, id, dto.reason);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @Permissions('expenses.manage')
  pay(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: PayBillDto,
  ) {
    return this.expenses.payBill(tenant, id, dto);
  }
}
