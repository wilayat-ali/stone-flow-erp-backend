import { UsersService } from '../users/users.service';
import { User } from '../users/domain/user';

import {
  // common
  Injectable,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CompanyRepository } from './infrastructure/persistence/company.repository';
import { IPaginationOptions } from '../utils/types/pagination-options';
import { Company } from './domain/company';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly userService: UsersService,

    // Dependencies here
    private readonly companyRepository: CompanyRepository,
  ) {}

  async create(createCompanyDto: CreateCompanyDto) {
    // Do not remove comment below.
    // <creating-property />

    const ownerUserObject = await this.userService.findById(
      createCompanyDto.ownerUser.id,
    );
    if (!ownerUserObject) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          ownerUser: 'notExists',
        },
      });
    }
    const ownerUser = ownerUserObject;

    return this.companyRepository.create({
      // Do not remove comment below.
      // <creating-property-payload />
      currency: createCompanyDto.currency,

      parchiLanguage: createCompanyDto.parchiLanguage,

      approvalRequired: createCompanyDto.approvalRequired,

      ntn: createCompanyDto.ntn,

      address: createCompanyDto.address,

      phone: createCompanyDto.phone,

      status: createCompanyDto.status,

      slug: createCompanyDto.slug,

      ownerUser,

      name: createCompanyDto.name,
    });
  }

  findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }) {
    return this.companyRepository.findAllWithPagination({
      paginationOptions: {
        page: paginationOptions.page,
        limit: paginationOptions.limit,
      },
    });
  }

  findById(id: Company['id']) {
    return this.companyRepository.findById(id);
  }

  findByIds(ids: Company['id'][]) {
    return this.companyRepository.findByIds(ids);
  }

  findBySlug(slug: Company['slug']) {
    return this.companyRepository.findBySlug(slug);
  }

  async update(
    id: Company['id'],

    updateCompanyDto: UpdateCompanyDto,
  ) {
    // Do not remove comment below.
    // <updating-property />

    let ownerUser: User | undefined = undefined;

    if (updateCompanyDto.ownerUser) {
      const ownerUserObject = await this.userService.findById(
        updateCompanyDto.ownerUser.id,
      );
      if (!ownerUserObject) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            ownerUser: 'notExists',
          },
        });
      }
      ownerUser = ownerUserObject;
    }

    return this.companyRepository.update(id, {
      // Do not remove comment below.
      // <updating-property-payload />
      currency: updateCompanyDto.currency,

      parchiLanguage: updateCompanyDto.parchiLanguage,

      approvalRequired: updateCompanyDto.approvalRequired,

      ntn: updateCompanyDto.ntn,

      address: updateCompanyDto.address,

      phone: updateCompanyDto.phone,

      status: updateCompanyDto.status,

      slug: updateCompanyDto.slug,

      ownerUser,

      name: updateCompanyDto.name,
    });
  }

  remove(id: Company['id']) {
    return this.companyRepository.remove(id);
  }
}
