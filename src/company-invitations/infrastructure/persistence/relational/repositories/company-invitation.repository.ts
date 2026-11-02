import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CompanyInvitationEntity } from '../entities/company-invitation.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { CompanyInvitation } from '../../../../domain/company-invitation';
import { CompanyInvitationRepository } from '../../company-invitation.repository';
import { CompanyInvitationMapper } from '../mappers/company-invitation.mapper';
import { IPaginationOptions } from '../../../../../utils/types/pagination-options';

@Injectable()
export class CompanyInvitationRelationalRepository implements CompanyInvitationRepository {
  constructor(
    @InjectRepository(CompanyInvitationEntity)
    private readonly companyInvitationRepository: Repository<CompanyInvitationEntity>,
  ) {}

  async create(data: CompanyInvitation): Promise<CompanyInvitation> {
    const persistenceModel = CompanyInvitationMapper.toPersistence(data);
    const newEntity = await this.companyInvitationRepository.save(
      this.companyInvitationRepository.create(persistenceModel),
    );
    return CompanyInvitationMapper.toDomain(newEntity);
  }

  async findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }): Promise<CompanyInvitation[]> {
    const entities = await this.companyInvitationRepository.find({
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });

    return entities.map((entity) => CompanyInvitationMapper.toDomain(entity));
  }

  async findById(
    id: CompanyInvitation['id'],
  ): Promise<NullableType<CompanyInvitation>> {
    const entity = await this.companyInvitationRepository.findOne({
      where: { id },
    });

    return entity ? CompanyInvitationMapper.toDomain(entity) : null;
  }

  async findByIds(
    ids: CompanyInvitation['id'][],
  ): Promise<CompanyInvitation[]> {
    const entities = await this.companyInvitationRepository.find({
      where: { id: In(ids) },
    });

    return entities.map((entity) => CompanyInvitationMapper.toDomain(entity));
  }

  async update(
    id: CompanyInvitation['id'],
    payload: Partial<CompanyInvitation>,
  ): Promise<CompanyInvitation> {
    const entity = await this.companyInvitationRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new Error('Record not found');
    }

    const updatedEntity = await this.companyInvitationRepository.save(
      this.companyInvitationRepository.create(
        CompanyInvitationMapper.toPersistence({
          ...CompanyInvitationMapper.toDomain(entity),
          ...payload,
        }),
      ),
    );

    return CompanyInvitationMapper.toDomain(updatedEntity);
  }

  async remove(id: CompanyInvitation['id']): Promise<void> {
    await this.companyInvitationRepository.delete(id);
  }
}
