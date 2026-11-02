import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CompanyPlatformEntity } from '../entities/company-platform.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { CompanyPlatform } from '../../../../domain/company-platform';
import { CompanyPlatformRepository } from '../../company-platform.repository';
import { CompanyPlatformMapper } from '../mappers/company-platform.mapper';
import { IPaginationOptions } from '../../../../../utils/types/pagination-options';

@Injectable()
export class CompanyPlatformRelationalRepository implements CompanyPlatformRepository {
  constructor(
    @InjectRepository(CompanyPlatformEntity)
    private readonly companyPlatformRepository: Repository<CompanyPlatformEntity>,
  ) {}

  async create(data: CompanyPlatform): Promise<CompanyPlatform> {
    const persistenceModel = CompanyPlatformMapper.toPersistence(data);
    const newEntity = await this.companyPlatformRepository.save(
      this.companyPlatformRepository.create(persistenceModel),
    );
    return CompanyPlatformMapper.toDomain(newEntity);
  }

  async findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }): Promise<CompanyPlatform[]> {
    const entities = await this.companyPlatformRepository.find({
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });

    return entities.map((entity) => CompanyPlatformMapper.toDomain(entity));
  }

  async findById(
    id: CompanyPlatform['id'],
  ): Promise<NullableType<CompanyPlatform>> {
    const entity = await this.companyPlatformRepository.findOne({
      where: { id },
    });

    return entity ? CompanyPlatformMapper.toDomain(entity) : null;
  }

  async findByIds(ids: CompanyPlatform['id'][]): Promise<CompanyPlatform[]> {
    const entities = await this.companyPlatformRepository.find({
      where: { id: In(ids) },
    });

    return entities.map((entity) => CompanyPlatformMapper.toDomain(entity));
  }

  async update(
    id: CompanyPlatform['id'],
    payload: Partial<CompanyPlatform>,
  ): Promise<CompanyPlatform> {
    const entity = await this.companyPlatformRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new Error('Record not found');
    }

    const updatedEntity = await this.companyPlatformRepository.save(
      this.companyPlatformRepository.create(
        CompanyPlatformMapper.toPersistence({
          ...CompanyPlatformMapper.toDomain(entity),
          ...payload,
        }),
      ),
    );

    return CompanyPlatformMapper.toDomain(updatedEntity);
  }

  async remove(id: CompanyPlatform['id']): Promise<void> {
    await this.companyPlatformRepository.delete(id);
  }
}
