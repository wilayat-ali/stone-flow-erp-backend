import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { CompanyAdminController } from './company-admin.controller';
import { CompanyService } from './company.service';
import { MembersService } from './members.service';
import { RolesAdminService } from './roles-admin.service';

@Module({
  imports: [InvitationsModule],
  controllers: [CompanyAdminController],
  providers: [CompanyService, MembersService, RolesAdminService],
  exports: [MembersService],
})
export class CompanyAdminModule {}
