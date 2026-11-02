import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { CompanyAdminController } from './company-admin.controller';
import { CompanyService } from './company.service';
import { MembersService } from './members.service';

@Module({
  imports: [InvitationsModule],
  controllers: [CompanyAdminController],
  providers: [CompanyService, MembersService],
  exports: [MembersService],
})
export class CompanyAdminModule {}
