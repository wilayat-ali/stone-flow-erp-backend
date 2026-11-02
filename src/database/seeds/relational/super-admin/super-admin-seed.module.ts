import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuperAdminEntity } from '../../../../super-admins/infrastructure/persistence/relational/entities/super-admin.entity';
import { SuperAdminSeedService } from './super-admin-seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([SuperAdminEntity])],
  providers: [SuperAdminSeedService],
  exports: [SuperAdminSeedService],
})
export class SuperAdminSeedModule {}
