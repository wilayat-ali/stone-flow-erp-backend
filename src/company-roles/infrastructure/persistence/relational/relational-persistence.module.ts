import { Module } from '@nestjs/common';
import { CompanyRoleRepository } from '../company-role.repository';
import { CompanyRoleRelationalRepository } from './repositories/company-role.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyRoleEntity } from './entities/company-role.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CompanyRoleEntity])],
  providers: [
    {
      provide: CompanyRoleRepository,
      useClass: CompanyRoleRelationalRepository,
    },
  ],
  exports: [CompanyRoleRepository],
})
export class RelationalCompanyRolePersistenceModule {}
