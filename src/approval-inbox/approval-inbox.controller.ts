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
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import { ApprovalInboxService } from './approval-inbox.service';
import { ListInboxQueryDto, RejectInboxDto } from './dto/inbox.dto';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// The one list of everything waiting for a decision. Anyone with
// approvals.view sees all of it, everyone else sees what they asked for. The
// decision itself is taken by the module that owns the record, so its own
// permission still decides who may approve a purchase or an expense.
@ApiTags('Approvals')
@CompanyAuth()
@Controller({ path: 'approvals', version: '1' })
export class ApprovalInboxController {
  constructor(private readonly inbox: ApprovalInboxService) {}

  @Get()
  list(@Tenant() tenant: TenantContext, @Query() query: ListInboxQueryDto) {
    return this.inbox.list(tenant, query);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Tenant() tenant: TenantContext, @Param('id', uuidPipe) id: string) {
    return this.inbox.approve(tenant, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Tenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: RejectInboxDto,
  ) {
    return this.inbox.reject(tenant, id, dto.reason);
  }
}
