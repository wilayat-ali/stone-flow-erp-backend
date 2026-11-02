import { CompaniesModule } from '../companies/companies.module';
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { CompanyRolesService } from './company-roles.service';
import { RelationalCompanyRolePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    CompaniesModule,

    // do not remove this comment
    RelationalCompanyRolePersistenceModule,
  ],
  providers: [CompanyRolesService],
  exports: [CompanyRolesService, RelationalCompanyRolePersistenceModule],
})
export class CompanyRolesModule {}
