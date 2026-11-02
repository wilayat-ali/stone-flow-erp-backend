import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { SuperAdminsService } from './super-admins.service';
import { RelationalSuperAdminPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    // do not remove this comment
    RelationalSuperAdminPersistenceModule,
  ],
  providers: [SuperAdminsService],
  exports: [SuperAdminsService, RelationalSuperAdminPersistenceModule],
})
export class SuperAdminsModule {}
