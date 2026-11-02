import { Company } from '../companies/domain/company';
import { CompaniesService } from '../companies/companies.service';
import {
  // common
  Injectable,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateCompanyPlatformDto } from './dto/create-company-platform.dto';
import { UpdateCompanyPlatformDto } from './dto/update-company-platform.dto';
import { CompanyPlatformRepository } from './infrastructure/persistence/company-platform.repository';
import { IPaginationOptions } from '../utils/types/pagination-options';
import { CompanyPlatform } from './domain/company-platform';

@Injectable()
export class CompanyPlatformsService {
  constructor(
    private readonly companyService: CompaniesService,

    // Dependencies here
    private readonly companyPlatformRepository: CompanyPlatformRepository,
  ) {}

  async create(createCompanyPlatformDto: CreateCompanyPlatformDto) {
    // Do not remove comment below.
    // <creating-property />

    const companyObject = await this.companyService.findById(
      createCompanyPlatformDto.company.id,
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

    return this.companyPlatformRepository.create({
      // Do not remove comment below.
      // <creating-property-payload />
      isEnabled: createCompanyPlatformDto.isEnabled,

      platformKey: createCompanyPlatformDto.platformKey,

      company,
    });
  }

  findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }) {
    return this.companyPlatformRepository.findAllWithPagination({
      paginationOptions: {
        page: paginationOptions.page,
        limit: paginationOptions.limit,
      },
    });
  }

  findById(id: CompanyPlatform['id']) {
    return this.companyPlatformRepository.findById(id);
  }

  findByIds(ids: CompanyPlatform['id'][]) {
    return this.companyPlatformRepository.findByIds(ids);
  }

  async update(
    id: CompanyPlatform['id'],

    updateCompanyPlatformDto: UpdateCompanyPlatformDto,
  ) {
    // Do not remove comment below.
    // <updating-property />

    let company: Company | undefined = undefined;

    if (updateCompanyPlatformDto.company) {
      const companyObject = await this.companyService.findById(
        updateCompanyPlatformDto.company.id,
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

    return this.companyPlatformRepository.update(id, {
      // Do not remove comment below.
      // <updating-property-payload />
      isEnabled: updateCompanyPlatformDto.isEnabled,

      platformKey: updateCompanyPlatformDto.platformKey,

      company,
    });
  }

  remove(id: CompanyPlatform['id']) {
    return this.companyPlatformRepository.remove(id);
  }
}
