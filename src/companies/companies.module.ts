import { UsersModule } from '../users/users.module';
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { RelationalCompanyPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    UsersModule,

    // do not remove this comment
    RelationalCompanyPersistenceModule,
  ],
  providers: [CompaniesService],
  exports: [CompaniesService, RelationalCompanyPersistenceModule],
})
export class CompaniesModule {}
