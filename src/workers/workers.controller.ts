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
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompanyAuth } from '../tenancy/decorators/company-auth.decorator';
import { Permissions } from '../tenancy/decorators/permissions.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import {
  AttendanceDto,
  CreateWorkerPaymentDto,
  RegisterDto,
  RejectWorkerPaymentDto,
} from './dto/worker-payment.dto';
import {
  CreateWorkerDto,
  ListWorkersQueryDto,
  UpdateWorkerDto,
} from './dto/worker.dto';
import { WorkerDaysService } from './worker-days.service';
import { WorkerPaymentsService } from './worker-payments.service';
import { WorkersService } from './workers.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Every route is scoped to the company in the caller's token; a company id is
// never read from the URL or body. Seeing needs expenses.view. Recording the
// attendance, the work register or a payment needs expenses.create (a munshi
// has it, and a payment waits for approval). Confirming or rejecting a payment
// needs expenses.manage.
//
// The fixed paths come before ':id', so "attendance" is never read as an id.
@ApiTags('Workers')
@CompanyAuth()
@Controller({ path: 'workers', version: '1' })
export class WorkersController {
  constructor(
    private readonly workers: WorkersService,
    private readonly days: WorkerDaysService,
    private readonly payments: WorkerPaymentsService,
  ) {}

  @Get('attendance/summary')
  @Permissions('expenses.view')
  attendanceSummary(
    @Tenant() tenant: TenantContext,
    @Query('month') month: string,
  ) {
    return this.days.attendanceSummary(tenant, month);
  }

  @Get('attendance')
  @Permissions('expenses.view')
  attendance(@Tenant() tenant: TenantContext, @Query('date') date: string) {
    return this.days.attendance(tenant, date);
  }

  @Put('attendance')
  @Permissions('expenses.create')
  saveAttendance(@Tenant() tenant: TenantContext, @Body() dto: AttendanceDto) {
    return this.days.saveAttendance(tenant, dto);
  }

  @Get('register')
  @Permissions('expenses.view')
  register(@Tenant() tenant: TenantContext, @Query('date') date: string) {
    return this.days.register(tenant, date);
  }

  @Put('register')
  @Permissions('expenses.create')
  saveRegister(@Tenant() tenant: TenantContext, @Body() dto: RegisterDto) {
    return this.days.saveRegister(tenant, dto);
  }

  @Get('payments')
  @Permissions('expenses.view')
  listPayments(
    @Tenant() tenant: TenantContext,
    @Query('workerId') workerId?: string,
  ) {
    return this.payments.list(tenant, workerId);
  }

  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('expenses.create')
  createPayment(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateWorkerPaymentDto,
  ) {
    return this.payments.create(tenant, dto);
  }

  @Post('payments/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @Permissions('expenses.manage')
  confirmPayment(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.payments.confirm(tenant, id);
  }

  @Post('payments/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('expenses.manage')
  rejectPayment(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: RejectWorkerPaymentDto,
  ) {
    return this.payments.reject(tenant, id, dto.reason);
  }

  @Get()
  @Permissions('expenses.view')
  list(@Tenant() tenant: TenantContext, @Query() query: ListWorkersQueryDto) {
    return this.workers.list(tenant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('expenses.manage')
  create(@Tenant() tenant: TenantContext, @Body() dto: CreateWorkerDto) {
    return this.workers.create(tenant, dto);
  }

  @Get(':id')
  @Permissions('expenses.view')
  get(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.workers.get(tenant, id);
  }

  @Get(':id/khata')
  @Permissions('expenses.view')
  khata(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.workers.khata(tenant, id);
  }

  @Patch(':id')
  @Permissions('expenses.manage')
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateWorkerDto,
  ) {
    return this.workers.update(tenant, id, dto);
  }
}
