import { CompaniesModule } from '../companies/companies.module';
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { RelationalAuditLogPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    CompaniesModule,

    // do not remove this comment
    RelationalAuditLogPersistenceModule,
  ],
  providers: [AuditLogsService],
  exports: [AuditLogsService, RelationalAuditLogPersistenceModule],
})
export class AuditLogsModule {}
