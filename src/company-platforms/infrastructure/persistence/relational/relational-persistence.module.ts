import { Module } from '@nestjs/common';
import { CompanyPlatformRepository } from '../company-platform.repository';
import { CompanyPlatformRelationalRepository } from './repositories/company-platform.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyPlatformEntity } from './entities/company-platform.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CompanyPlatformEntity])],
  providers: [
    {
      provide: CompanyPlatformRepository,
      useClass: CompanyPlatformRelationalRepository,
    },
  ],
  exports: [CompanyPlatformRepository],
})
export class RelationalCompanyPlatformPersistenceModule {}
