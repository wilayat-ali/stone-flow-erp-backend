import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from '../audit-logs/infrastructure/persistence/relational/entities/audit-log.entity';
import { LoginThrottleService } from '../auth/login-throttle.service';
import { CompanyEntity } from '../companies/infrastructure/persistence/relational/entities/company.entity';
import { CompanyInvitationEntity } from '../company-invitations/infrastructure/persistence/relational/entities/company-invitation.entity';
import { CompanyMemberEntity } from '../company-members/infrastructure/persistence/relational/entities/company-member.entity';
import { CompanyPlatformEntity } from '../company-platforms/infrastructure/persistence/relational/entities/company-platform.entity';
import { CompanyRoleEntity } from '../company-roles/infrastructure/persistence/relational/entities/company-role.entity';
import { SuperAdminEntity } from '../super-admins/infrastructure/persistence/relational/entities/super-admin.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { AuditService } from './audit.service';

// Global so the tenancy guards (CompanyGuard, PlatformGuard) can be used on
// any controller without that module importing their repositories.
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntity,
      CompanyEntity,
      CompanyInvitationEntity,
      CompanyMemberEntity,
      CompanyPlatformEntity,
      CompanyRoleEntity,
      SuperAdminEntity,
      UserEntity,
    ]),
  ],
  providers: [AuditService, LoginThrottleService],
  exports: [TypeOrmModule, AuditService, LoginThrottleService],
})
export class TenancyModule {}
