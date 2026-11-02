import {
  // common
  Injectable,
} from '@nestjs/common';
import { CreateSuperAdminDto } from './dto/create-super-admin.dto';
import { UpdateSuperAdminDto } from './dto/update-super-admin.dto';
import { SuperAdminRepository } from './infrastructure/persistence/super-admin.repository';
import { IPaginationOptions } from '../utils/types/pagination-options';
import { SuperAdmin } from './domain/super-admin';

@Injectable()
export class SuperAdminsService {
  constructor(
    // Dependencies here
    private readonly superAdminRepository: SuperAdminRepository,
  ) {}

  async create(createSuperAdminDto: CreateSuperAdminDto) {
    // Do not remove comment below.
    // <creating-property />

    return this.superAdminRepository.create({
      // Do not remove comment below.
      // <creating-property-payload />
      lastLoginAt: createSuperAdminDto.lastLoginAt,

      status: createSuperAdminDto.status,

      role: createSuperAdminDto.role,

      passwordHash: createSuperAdminDto.passwordHash,

      email: createSuperAdminDto.email,

      name: createSuperAdminDto.name,
    });
  }

  findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }) {
    return this.superAdminRepository.findAllWithPagination({
      paginationOptions: {
        page: paginationOptions.page,
        limit: paginationOptions.limit,
      },
    });
  }

  findById(id: SuperAdmin['id']) {
    return this.superAdminRepository.findById(id);
  }

  findByIds(ids: SuperAdmin['id'][]) {
    return this.superAdminRepository.findByIds(ids);
  }

  async update(
    id: SuperAdmin['id'],

    updateSuperAdminDto: UpdateSuperAdminDto,
  ) {
    // Do not remove comment below.
    // <updating-property />

    return this.superAdminRepository.update(id, {
      // Do not remove comment below.
      // <updating-property-payload />
      lastLoginAt: updateSuperAdminDto.lastLoginAt,

      status: updateSuperAdminDto.status,

      role: updateSuperAdminDto.role,

      passwordHash: updateSuperAdminDto.passwordHash,

      email: updateSuperAdminDto.email,

      name: updateSuperAdminDto.name,
    });
  }

  remove(id: SuperAdmin['id']) {
    return this.superAdminRepository.remove(id);
  }
}
