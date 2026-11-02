import { CompanyMembersModule } from '../company-members/company-members.module';
import { UsersModule } from '../users/users.module';
import { CompanyRolesModule } from '../company-roles/company-roles.module';
import { CompaniesModule } from '../companies/companies.module';
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { CompanyInvitationsService } from './company-invitations.service';
import { RelationalCompanyInvitationPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    CompanyMembersModule,

    UsersModule,

    CompanyRolesModule,

    CompaniesModule,

    // do not remove this comment
    RelationalCompanyInvitationPersistenceModule,
  ],
  providers: [CompanyInvitationsService],
  exports: [
    CompanyInvitationsService,
    RelationalCompanyInvitationPersistenceModule,
  ],
})
export class CompanyInvitationsModule {}
