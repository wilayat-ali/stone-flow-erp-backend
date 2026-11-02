import { CompaniesModule } from '../companies/companies.module';
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { CompanyPlatformsService } from './company-platforms.service';
import { RelationalCompanyPlatformPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    CompaniesModule,

    // do not remove this comment
    RelationalCompanyPlatformPersistenceModule,
  ],
  providers: [CompanyPlatformsService],
  exports: [
    CompanyPlatformsService,
    RelationalCompanyPlatformPersistenceModule,
  ],
})
export class CompanyPlatformsModule {}
