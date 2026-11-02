import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvitationsService } from '../invitations/invitations.service';
import { CompanyAuth } from '../tenancy/decorators/company-auth.decorator';
import { CompanyRoles } from '../tenancy/decorators/company-roles.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import { ChangeMemberRoleDto, InviteMemberDto } from './dto/company-admin.dto';
import { CompanyService } from './company.service';
import { MembersService } from './members.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Every route here is scoped to the company in the caller's token. The
// company id is never taken from the URL or body.
@ApiTags('Company')
@CompanyAuth()
@Controller({
  path: 'company',
  version: '1',
})
export class CompanyAdminController {
  constructor(
    private readonly company: CompanyService,
    private readonly members: MembersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get('me')
  me(@Tenant() tenant: TenantContext) {
    return this.company.me(tenant);
  }

  @Get('members')
  @CompanyRoles('owner', 'partner', 'manager')
  listMembers(@Tenant() tenant: TenantContext) {
    return this.members.list(tenant.companyId);
  }

  @Post('members/:memberId/deactivate')
  @HttpCode(HttpStatus.OK)
  @CompanyRoles('owner', 'partner')
  deactivate(
    @Tenant() tenant: TenantContext,
    @Param('memberId', uuidPipe) memberId: string,
  ) {
    return this.members.deactivate(tenant, memberId);
  }

  @Post('members/:memberId/activate')
  @HttpCode(HttpStatus.OK)
  @CompanyRoles('owner', 'partner')
  activate(
    @Tenant() tenant: TenantContext,
    @Param('memberId', uuidPipe) memberId: string,
  ) {
    return this.members.activate(tenant, memberId);
  }

  @Patch('members/:memberId/role')
  @CompanyRoles('owner', 'partner')
  changeRole(
    @Tenant() tenant: TenantContext,
    @Param('memberId', uuidPipe) memberId: string,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    return this.members.changeRole(tenant, memberId, dto.roleKey);
  }

  // For a munshi who forgot their password: share the returned link (for
  // example on WhatsApp). Not allowed for the owner, or for people who also
  // work in another company.
  @Post('members/:memberId/reset-link')
  @HttpCode(HttpStatus.OK)
  @CompanyRoles('owner', 'partner')
  resetLink(
    @Tenant() tenant: TenantContext,
    @Param('memberId', uuidPipe) memberId: string,
  ) {
    return this.invitations.createResetLink(
      { companyId: tenant.companyId, memberId },
      { type: 'member', tenant },
    );
  }

  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  @CompanyRoles('owner', 'partner')
  invite(@Tenant() tenant: TenantContext, @Body() dto: InviteMemberDto) {
    return this.invitations.createInvitation(tenant, dto);
  }

  @Get('invitations')
  @CompanyRoles('owner', 'partner')
  listInvitations(@Tenant() tenant: TenantContext) {
    return this.invitations.listPending(tenant.companyId);
  }

  @Delete('invitations/:invitationId')
  @CompanyRoles('owner', 'partner')
  revokeInvitation(
    @Tenant() tenant: TenantContext,
    @Param('invitationId', uuidPipe) invitationId: string,
  ) {
    return this.invitations.revoke(tenant, invitationId);
  }
}
