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
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { InvitationsService } from '../invitations/invitations.service';
import { CompanyAuth } from '../tenancy/decorators/company-auth.decorator';
import { Permissions } from '../tenancy/decorators/permissions.decorator';
import { Tenant, TenantContext } from '../tenancy/tenant-context';
import {
  ChangeBrandingDto,
  ChangeSettingsDto,
  ChangeMemberRoleDto,
  InviteMemberDto,
} from './dto/company-admin.dto';
import { RoleInputDto, RoleViewDto } from './dto/role.dto';
import { CompanyService } from './company.service';
import { MembersService } from './members.service';
import { RolesAdminService } from './roles-admin.service';

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
    private readonly roles: RolesAdminService,
  ) {}

  @Get('me')
  me(@Tenant() tenant: TenantContext) {
    return this.company.me(tenant);
  }

  @Get('settings')
  settings(@Tenant() tenant: TenantContext) {
    return this.company.settings(tenant);
  }

  @Patch('settings')
  @Permissions('approvals.configure')
  setSettings(@Tenant() tenant: TenantContext, @Body() dto: ChangeSettingsDto) {
    return this.company.setApprovalRequired(tenant, dto.approvalRequired);
  }

  @Patch('branding')
  @Permissions('branding.manage')
  setBranding(@Tenant() tenant: TenantContext, @Body() dto: ChangeBrandingDto) {
    return this.company.setTheme(tenant, dto.theme);
  }

  @Get('members')
  @Permissions('users.view', 'users.manage', 'roles.view')
  listMembers(@Tenant() tenant: TenantContext) {
    return this.members.list(tenant.companyId);
  }

  @Post('members/:memberId/deactivate')
  @HttpCode(HttpStatus.OK)
  @Permissions('users.manage')
  deactivate(
    @Tenant() tenant: TenantContext,
    @Param('memberId', uuidPipe) memberId: string,
  ) {
    return this.members.deactivate(tenant, memberId);
  }

  @Post('members/:memberId/activate')
  @HttpCode(HttpStatus.OK)
  @Permissions('users.manage')
  activate(
    @Tenant() tenant: TenantContext,
    @Param('memberId', uuidPipe) memberId: string,
  ) {
    return this.members.activate(tenant, memberId);
  }

  @Patch('members/:memberId/role')
  @Permissions('users.manage')
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
  @Permissions('users.manage')
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
  @Permissions('users.manage')
  invite(@Tenant() tenant: TenantContext, @Body() dto: InviteMemberDto) {
    return this.invitations.createInvitation(tenant, dto);
  }

  @Get('invitations')
  @Permissions('users.manage')
  listInvitations(@Tenant() tenant: TenantContext) {
    return this.invitations.listPending(tenant.companyId);
  }

  // The company's roles with what each may do, and how many people have it.
  // The invite sheet needs the list too, hence the wider read access.
  @Get('roles')
  @Permissions('roles.view', 'roles.manage', 'users.view', 'users.manage')
  @ApiOkResponse({ type: [RoleViewDto] })
  listRoles(@Tenant() tenant: TenantContext) {
    return this.roles.list(tenant.companyId);
  }

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('roles.manage')
  @ApiOkResponse({ type: RoleViewDto })
  createRole(@Tenant() tenant: TenantContext, @Body() dto: RoleInputDto) {
    return this.roles.create(tenant, dto);
  }

  @Patch('roles/:key')
  @Permissions('roles.manage')
  @ApiOkResponse({ type: RoleViewDto })
  updateRole(
    @Tenant() tenant: TenantContext,
    @Param('key') key: string,
    @Body() dto: RoleInputDto,
  ) {
    return this.roles.update(tenant, key, dto);
  }

  @Delete('roles/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('roles.manage')
  deleteRole(@Tenant() tenant: TenantContext, @Param('key') key: string) {
    return this.roles.remove(tenant, key);
  }

  @Delete('invitations/:invitationId')
  @Permissions('users.manage')
  revokeInvitation(
    @Tenant() tenant: TenantContext,
    @Param('invitationId', uuidPipe) invitationId: string,
  ) {
    return this.invitations.revoke(tenant, invitationId);
  }
}
