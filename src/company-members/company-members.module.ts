import { CompanyRolesModule } from '../company-roles/company-roles.module';
import { UsersModule } from '../users/users.module';
import { CompaniesModule } from '../companies/companies.module';
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { CompanyMembersService } from './company-members.service';
import { RelationalCompanyMemberPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    CompanyRolesModule,

    UsersModule,

    CompaniesModule,

    // do not remove this comment
    RelationalCompanyMemberPersistenceModule,
  ],
  providers: [CompanyMembersService],
  exports: [CompanyMembersService, RelationalCompanyMemberPersistenceModule],
})
export class CompanyMembersModule {}
