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
import { MembersService } from '../company-admin/members.service';
import { InvitationsService } from '../invitations/invitations.service';
import {
  CurrentSuperAdmin,
  SuperAdminAuth,
} from './decorators/superadmin-auth.decorator';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  ListCompaniesQueryDto,
  SetPlatformDto,
} from './dto/company-admin-queries.dto';
import { SuperAdminPrincipal } from './strategies/jwt-superadmin.strategy';
import { SuperAdminCompaniesService } from './superadmin-companies.service';

const uuidPipe = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});

// Only super_admin can change anything; support can read and issue
// password links (every one is audit-logged).
@ApiTags('Super Admin')
@Controller({
  path: 'superadmin/companies',
  version: '1',
})
export class SuperAdminCompaniesController {
  constructor(
    private readonly service: SuperAdminCompaniesService,
    private readonly members: MembersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Post()
  @SuperAdminAuth('super_admin')
  create(
    @Body() dto: CreateCompanyDto,
    @CurrentSuperAdmin() admin: SuperAdminPrincipal,
  ) {
    return this.service.create(dto, admin);
  }

  @Get()
  @SuperAdminAuth()
  list(@Query() query: ListCompaniesQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @SuperAdminAuth()
  get(@Param('id', uuidPipe) id: string) {
    return this.service.get(id);
  }

  @Patch(':id/suspend')
  @SuperAdminAuth('super_admin')
  suspend(
    @Param('id', uuidPipe) id: string,
    @CurrentSuperAdmin() admin: SuperAdminPrincipal,
  ) {
    return this.service.setStatus(id, 'suspended', admin);
  }

  @Patch(':id/reactivate')
  @SuperAdminAuth('super_admin')
  reactivate(
    @Param('id', uuidPipe) id: string,
    @CurrentSuperAdmin() admin: SuperAdminPrincipal,
  ) {
    return this.service.setStatus(id, 'active', admin);
  }

  @Get(':id/platforms')
  @SuperAdminAuth()
  getPlatforms(@Param('id', uuidPipe) id: string) {
    return this.service.getPlatforms(id);
  }

  @Put(':id/platforms/:key')
  @SuperAdminAuth('super_admin')
  setPlatform(
    @Param('id', uuidPipe) id: string,
    @Param('key') key: string,
    @Body() dto: SetPlatformDto,
    @CurrentSuperAdmin() admin: SuperAdminPrincipal,
  ) {
    return this.service.setPlatform(id, key, dto.isEnabled, admin);
  }

  @Get(':id/members')
  @SuperAdminAuth()
  listMembers(@Param('id', uuidPipe) id: string) {
    return this.members.list(id);
  }

  // Recovery path for people the company cannot reset itself: owners and
  // members who belong to several companies. Support must verify the person's
  // identity first (for example by phone).
  @Post(':id/members/:memberId/reset-link')
  @HttpCode(HttpStatus.OK)
  @SuperAdminAuth()
  createResetLink(
    @Param('id', uuidPipe) id: string,
    @Param('memberId', uuidPipe) memberId: string,
    @CurrentSuperAdmin() admin: SuperAdminPrincipal,
  ) {
    return this.invitations.createResetLink(
      { companyId: id, memberId },
      { type: 'superadmin', id: admin.id, role: admin.role },
    );
  }
}
