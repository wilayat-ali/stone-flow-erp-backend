import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';
import { FilesModule } from './files/files.module';
import { AuthModule } from './auth/auth.module';
import databaseConfig from './database/config/database.config';
import authConfig from './auth/config/auth.config';
import appConfig from './config/app.config';
import mailConfig from './mail/config/mail.config';
import fileConfig from './files/config/file.config';
import path from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HeaderResolver, I18nModule } from 'nestjs-i18n';
import { TypeOrmConfigService } from './database/typeorm-config.service';
import { MailModule } from './mail/mail.module';
import { HomeModule } from './home/home.module';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AllConfigType } from './config/config.type';
import { SessionModule } from './session/session.module';
import { MailerModule } from './mailer/mailer.module';

const infrastructureDatabaseModule = TypeOrmModule.forRootAsync({
  useClass: TypeOrmConfigService,
  dataSourceFactory: async (options: DataSourceOptions) => {
    return new DataSource(options).initialize();
  },
});

import { CompaniesModule } from './companies/companies.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { NotificationsModule } from './notifications/notifications.module';
import { InvitationsModule } from './invitations/invitations.module';
import { CompanyAdminModule } from './company-admin/company-admin.module';
import { SuperAdminModule } from './superadmin/superadmin.module';

import { CompanyPlatformsModule } from './company-platforms/company-platforms.module';

import { CompanyRolesModule } from './company-roles/company-roles.module';

import { CompanyMembersModule } from './company-members/company-members.module';

import { CompanyInvitationsModule } from './company-invitations/company-invitations.module';

import { SuperAdminsModule } from './super-admins/super-admins.module';

import { AuditLogsModule } from './audit-logs/audit-logs.module';

import { AccountsModule } from './accounts/accounts.module';

import { LedgerEntriesModule } from './ledger-entries/ledger-entries.module';

import { PartyLedgerEntriesModule } from './party-ledger-entries/party-ledger-entries.module';

import { StockMovementsModule } from './stock-movements/stock-movements.module';

import { ApprovalsModule } from './approvals/approvals.module';

import { CashBankModule } from './cash-bank/cash-bank.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { SettingsModule } from './settings/settings.module';
import { PurchasesModule } from './purchases/purchases.module';
import { SupplierPaymentsModule } from './supplier-payments/supplier-payments.module';
import { InventoryModule } from './inventory/inventory.module';
import { WorkersModule } from './workers/workers.module';
import { ProductionModule } from './production/production.module';
import { CustomersModule } from './customers/customers.module';
import { SalesModule } from './sales/sales.module';
import { ExpensesModule } from './expenses/expenses.module';
import { LoansModule } from './loans/loans.module';
import { MonthEndModule } from './month-close/month-end.module';
import { ApprovalInboxModule } from './approval-inbox/approval-inbox.module';

@Module({
  imports: [
    CashBankModule,
    SuppliersModule,
    SettingsModule,
    PurchasesModule,
    SupplierPaymentsModule,
    InventoryModule,
    WorkersModule,
    ProductionModule,
    CustomersModule,
    SalesModule,
    ExpensesModule,
    LoansModule,
    MonthEndModule,
    ApprovalInboxModule,
    ApprovalsModule,
    StockMovementsModule,
    PartyLedgerEntriesModule,
    LedgerEntriesModule,
    AccountsModule,
    TenancyModule,
    NotificationsModule,
    InvitationsModule,
    CompanyAdminModule,
    SuperAdminModule,
    WorkspacesModule,
    AuditLogsModule,
    SuperAdminsModule,
    CompanyInvitationsModule,
    CompanyMembersModule,
    CompanyRolesModule,
    CompanyPlatformsModule,
    CompaniesModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, authConfig, appConfig, mailConfig, fileConfig],
      envFilePath: ['.env'],
    }),
    infrastructureDatabaseModule,
    I18nModule.forRootAsync({
      useFactory: (configService: ConfigService<AllConfigType>) => ({
        fallbackLanguage: configService.getOrThrow('app.fallbackLanguage', {
          infer: true,
        }),
        loaderOptions: { path: path.join(__dirname, '/i18n/'), watch: true },
      }),
      resolvers: [
        {
          use: HeaderResolver,
          useFactory: (configService: ConfigService<AllConfigType>) => {
            return [
              configService.get('app.headerLanguage', {
                infer: true,
              }),
            ];
          },
          inject: [ConfigService],
        },
      ],
      imports: [ConfigModule],
      inject: [ConfigService],
    }),
    UsersModule,
    FilesModule,
    AuthModule,
    SessionModule,
    MailModule,
    MailerModule,
    HomeModule,
  ],
})
export class AppModule {}
