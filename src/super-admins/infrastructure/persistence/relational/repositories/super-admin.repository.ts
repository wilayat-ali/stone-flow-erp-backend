import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { SuperAdminEntity } from '../entities/super-admin.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { SuperAdmin } from '../../../../domain/super-admin';
import { SuperAdminRepository } from '../../super-admin.repository';
import { SuperAdminMapper } from '../mappers/super-admin.mapper';
import { IPaginationOptions } from '../../../../../utils/types/pagination-options';

@Injectable()
export class SuperAdminRelationalRepository implements SuperAdminRepository {
  constructor(
    @InjectRepository(SuperAdminEntity)
    private readonly superAdminRepository: Repository<SuperAdminEntity>,
  ) {}

  async create(data: SuperAdmin): Promise<SuperAdmin> {
    const persistenceModel = SuperAdminMapper.toPersistence(data);
    const newEntity = await this.superAdminRepository.save(
      this.superAdminRepository.create(persistenceModel),
    );
    return SuperAdminMapper.toDomain(newEntity);
  }

  async findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }): Promise<SuperAdmin[]> {
    const entities = await this.superAdminRepository.find({
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });

    return entities.map((entity) => SuperAdminMapper.toDomain(entity));
  }

  async findById(id: SuperAdmin['id']): Promise<NullableType<SuperAdmin>> {
    const entity = await this.superAdminRepository.findOne({
      where: { id },
    });

    return entity ? SuperAdminMapper.toDomain(entity) : null;
  }

  async findByIds(ids: SuperAdmin['id'][]): Promise<SuperAdmin[]> {
    const entities = await this.superAdminRepository.find({
      where: { id: In(ids) },
    });

    return entities.map((entity) => SuperAdminMapper.toDomain(entity));
  }

  async update(
    id: SuperAdmin['id'],
    payload: Partial<SuperAdmin>,
  ): Promise<SuperAdmin> {
    const entity = await this.superAdminRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new Error('Record not found');
    }

    const updatedEntity = await this.superAdminRepository.save(
      this.superAdminRepository.create(
        SuperAdminMapper.toPersistence({
          ...SuperAdminMapper.toDomain(entity),
          ...payload,
        }),
      ),
    );

    return SuperAdminMapper.toDomain(updatedEntity);
  }

  async remove(id: SuperAdmin['id']): Promise<void> {
    await this.superAdminRepository.delete(id);
  }
}
