import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { CompanyAdminModule } from '../company-admin/company-admin.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SuperAdminRolesGuard } from './decorators/superadmin-auth.decorator';
import { JwtSuperAdminStrategy } from './strategies/jwt-superadmin.strategy';
import { SuperAdminAuthController } from './superadmin-auth.controller';
import { SuperAdminAuthService } from './superadmin-auth.service';
import { SuperAdminCompaniesController } from './superadmin-companies.controller';
import { SuperAdminCompaniesService } from './superadmin-companies.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    NotificationsModule,
    CompanyAdminModule,
    InvitationsModule,
  ],
  controllers: [SuperAdminAuthController, SuperAdminCompaniesController],
  providers: [
    JwtSuperAdminStrategy,
    SuperAdminRolesGuard,
    SuperAdminAuthService,
    SuperAdminCompaniesService,
  ],
})
export class SuperAdminModule {}
