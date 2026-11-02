import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CompanyRoleEntity } from '../entities/company-role.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { CompanyRole } from '../../../../domain/company-role';
import { CompanyRoleRepository } from '../../company-role.repository';
import { CompanyRoleMapper } from '../mappers/company-role.mapper';
import { IPaginationOptions } from '../../../../../utils/types/pagination-options';

@Injectable()
export class CompanyRoleRelationalRepository implements CompanyRoleRepository {
  constructor(
    @InjectRepository(CompanyRoleEntity)
    private readonly companyRoleRepository: Repository<CompanyRoleEntity>,
  ) {}

  async create(data: CompanyRole): Promise<CompanyRole> {
    const persistenceModel = CompanyRoleMapper.toPersistence(data);
    const newEntity = await this.companyRoleRepository.save(
      this.companyRoleRepository.create(persistenceModel),
    );
    return CompanyRoleMapper.toDomain(newEntity);
  }

  async findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }): Promise<CompanyRole[]> {
    const entities = await this.companyRoleRepository.find({
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });

    return entities.map((entity) => CompanyRoleMapper.toDomain(entity));
  }

  async findById(id: CompanyRole['id']): Promise<NullableType<CompanyRole>> {
    const entity = await this.companyRoleRepository.findOne({
      where: { id },
    });

    return entity ? CompanyRoleMapper.toDomain(entity) : null;
  }

  async findByIds(ids: CompanyRole['id'][]): Promise<CompanyRole[]> {
    const entities = await this.companyRoleRepository.find({
      where: { id: In(ids) },
    });

    return entities.map((entity) => CompanyRoleMapper.toDomain(entity));
  }

  async update(
    id: CompanyRole['id'],
    payload: Partial<CompanyRole>,
  ): Promise<CompanyRole> {
    const entity = await this.companyRoleRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new Error('Record not found');
    }

    const updatedEntity = await this.companyRoleRepository.save(
      this.companyRoleRepository.create(
        CompanyRoleMapper.toPersistence({
          ...CompanyRoleMapper.toDomain(entity),
          ...payload,
        }),
      ),
    );

    return CompanyRoleMapper.toDomain(updatedEntity);
  }

  async remove(id: CompanyRole['id']): Promise<void> {
    await this.companyRoleRepository.delete(id);
  }
}
