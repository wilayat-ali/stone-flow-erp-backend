import { Module } from '@nestjs/common';
import { CompanyInvitationRepository } from '../company-invitation.repository';
import { CompanyInvitationRelationalRepository } from './repositories/company-invitation.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyInvitationEntity } from './entities/company-invitation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CompanyInvitationEntity])],
  providers: [
    {
      provide: CompanyInvitationRepository,
      useClass: CompanyInvitationRelationalRepository,
    },
  ],
  exports: [CompanyInvitationRepository],
})
export class RelationalCompanyInvitationPersistenceModule {}
