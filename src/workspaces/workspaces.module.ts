import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [CompaniesModule],
  controllers: [WorkspacesController],
})
export class WorkspacesModule {}
