import { Module } from '@nestjs/common';
import { SuperAdminRepository } from '../super-admin.repository';
import { SuperAdminRelationalRepository } from './repositories/super-admin.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuperAdminEntity } from './entities/super-admin.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SuperAdminEntity])],
  providers: [
    {
      provide: SuperAdminRepository,
      useClass: SuperAdminRelationalRepository,
    },
  ],
  exports: [SuperAdminRepository],
})
export class RelationalSuperAdminPersistenceModule {}
