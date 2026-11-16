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
import { CompanyRoles } from '../tenancy/decorators/company-roles.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import { CashBankAccountsService } from './cash-bank-accounts.service';
import { CashBankEntriesService } from './cash-bank-entries.service';
import { CASH_BANK_ROLES } from './cash-bank.policy';
import {
  CashCountDto,
  CreateAccountDto,
  DepositDto,
  ListAccountsQueryDto,
  ListApprovalsQueryDto,
  MoneyEntryDto,
  RejectDto,
  ReverseEntryDto,
  StatementQueryDto,
  TransferDto,
  UpdateAccountDto,
} from './dto/cash-bank.dto';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Cash & Bank is core: always on, no @Module() switch. Every route is scoped
// to the company in the caller's token; a company id is never read from the
// URL or body. Roles: see cash-bank.policy.ts. A Viewer can read, nothing more.
@ApiTags('Cash & Bank')
@CompanyAuth()
@Controller({ path: 'cash-bank', version: '1' })
export class CashBankController {
  constructor(
    private readonly accounts: CashBankAccountsService,
    private readonly entries: CashBankEntriesService,
  ) {}

  @Get('accounts')
  listAccounts(
    @Tenant() tenant: TenantContext,
    @Query() query: ListAccountsQueryDto,
  ) {
    return this.accounts.list(tenant, query.includeInactive);
  }

  @Post('accounts')
  @CompanyRoles(...CASH_BANK_ROLES.manageAccounts)
  createAccount(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accounts.create(tenant, dto);
  }

  @Patch('accounts/:id')
  @CompanyRoles(...CASH_BANK_ROLES.manageAccounts)
  updateAccount(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accounts.update(tenant, id, dto);
  }

  @Get('accounts/:id/statement')
  statement(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.entries.statement(tenant, id, query);
  }

  @Post('transfers')
  @CompanyRoles(...CASH_BANK_ROLES.transfer)
  transfer(@Tenant() tenant: TenantContext, @Body() dto: TransferDto) {
    return this.entries.transfer(tenant, dto);
  }

  @Post('deposits')
  @CompanyRoles(...CASH_BANK_ROLES.postEntries)
  deposit(@Tenant() tenant: TenantContext, @Body() dto: DepositDto) {
    return this.entries.deposit(tenant, dto);
  }

  @Post('other-payments')
  @CompanyRoles(...CASH_BANK_ROLES.postEntries)
  otherPayment(@Tenant() tenant: TenantContext, @Body() dto: MoneyEntryDto) {
    return this.entries.moneyEntry(tenant, 'out', dto);
  }

  @Post('other-receipts')
  @CompanyRoles(...CASH_BANK_ROLES.postEntries)
  otherReceipt(@Tenant() tenant: TenantContext, @Body() dto: MoneyEntryDto) {
    return this.entries.moneyEntry(tenant, 'in', dto);
  }

  @Post('cash-count')
  @HttpCode(HttpStatus.OK)
  @CompanyRoles(...CASH_BANK_ROLES.countCash)
  cashCount(@Tenant() tenant: TenantContext, @Body() dto: CashCountDto) {
    return this.entries.cashCount(tenant, dto);
  }

  @Post('entries/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @CompanyRoles(...CASH_BANK_ROLES.reverse)
  reverse(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: ReverseEntryDto,
  ) {
    return this.entries.reverse(tenant, id, dto);
  }

  // Owner/Partner/Manager see all requests; a munshi sees only their own.
  @Get('approvals')
  @CompanyRoles(...CASH_BANK_ROLES.postEntries)
  listApprovals(
    @Tenant() tenant: TenantContext,
    @Query() query: ListApprovalsQueryDto,
  ) {
    return this.entries.listApprovals(tenant, query);
  }

  @Post('approvals/:id/approve')
  @HttpCode(HttpStatus.OK)
  @CompanyRoles(...CASH_BANK_ROLES.decide)
  approve(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.entries.approve(tenant, id);
  }

  @Post('approvals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @CompanyRoles(...CASH_BANK_ROLES.decide)
  reject(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: RejectDto,
  ) {
    return this.entries.reject(tenant, id, dto.reason);
  }
}
