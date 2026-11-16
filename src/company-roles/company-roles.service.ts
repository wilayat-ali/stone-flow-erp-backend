import { Company } from '../companies/domain/company';
import { CompaniesService } from '../companies/companies.service';
import {
  // common
  Injectable,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateCompanyRoleDto } from './dto/create-company-role.dto';
import { UpdateCompanyRoleDto } from './dto/update-company-role.dto';
import { CompanyRoleRepository } from './infrastructure/persistence/company-role.repository';
import { IPaginationOptions } from '../utils/types/pagination-options';
import { CompanyRole } from './domain/company-role';

@Injectable()
export class CompanyRolesService {
  constructor(
    private readonly companyService: CompaniesService,

    // Dependencies here
    private readonly companyRoleRepository: CompanyRoleRepository,
  ) {}

  async create(createCompanyRoleDto: CreateCompanyRoleDto) {
    // Do not remove comment below.
    // <creating-property />

    const companyObject = await this.companyService.findById(
      createCompanyRoleDto.company.id,
    );
    if (!companyObject) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          company: 'notExists',
        },
      });
    }
    const company = companyObject;

    return this.companyRoleRepository.create({
      // Do not remove comment below.
      // <creating-property-payload />
      isSystem: createCompanyRoleDto.isSystem,

      key: createCompanyRoleDto.key,

      name: createCompanyRoleDto.name,

      description: createCompanyRoleDto.description ?? '',

      permissions: createCompanyRoleDto.permissions ?? [],

      company,
    });
  }

  findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }) {
    return this.companyRoleRepository.findAllWithPagination({
      paginationOptions: {
        page: paginationOptions.page,
        limit: paginationOptions.limit,
      },
    });
  }

  findById(id: CompanyRole['id']) {
    return this.companyRoleRepository.findById(id);
  }

  findByIds(ids: CompanyRole['id'][]) {
    return this.companyRoleRepository.findByIds(ids);
  }

  async update(
    id: CompanyRole['id'],

    updateCompanyRoleDto: UpdateCompanyRoleDto,
  ) {
    // Do not remove comment below.
    // <updating-property />

    let company: Company | undefined = undefined;

    if (updateCompanyRoleDto.company) {
      const companyObject = await this.companyService.findById(
        updateCompanyRoleDto.company.id,
      );
      if (!companyObject) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            company: 'notExists',
          },
        });
      }
      company = companyObject;
    }

    return this.companyRoleRepository.update(id, {
      // Do not remove comment below.
      // <updating-property-payload />
      isSystem: updateCompanyRoleDto.isSystem,

      key: updateCompanyRoleDto.key,

      name: updateCompanyRoleDto.name,

      description: updateCompanyRoleDto.description,

      permissions: updateCompanyRoleDto.permissions,

      company,
    });
  }

  remove(id: CompanyRole['id']) {
    return this.companyRoleRepository.remove(id);
  }
}
