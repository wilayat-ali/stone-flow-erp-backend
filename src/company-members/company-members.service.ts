import { CompanyRolesService } from '../company-roles/company-roles.service';
import { CompanyRole } from '../company-roles/domain/company-role';

import { UsersService } from '../users/users.service';
import { User } from '../users/domain/user';

import { Company } from '../companies/domain/company';
import { CompaniesService } from '../companies/companies.service';
import {
  // common
  Injectable,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateCompanyMemberDto } from './dto/create-company-member.dto';
import { UpdateCompanyMemberDto } from './dto/update-company-member.dto';
import { CompanyMemberRepository } from './infrastructure/persistence/company-member.repository';
import { IPaginationOptions } from '../utils/types/pagination-options';
import { CompanyMember } from './domain/company-member';

@Injectable()
export class CompanyMembersService {
  constructor(
    private readonly companyRoleService: CompanyRolesService,

    private readonly userService: UsersService,

    private readonly companyService: CompaniesService,

    // Dependencies here
    private readonly companyMemberRepository: CompanyMemberRepository,
  ) {}

  async create(createCompanyMemberDto: CreateCompanyMemberDto) {
    // Do not remove comment below.
    // <creating-property />

    let invitedByMember: CompanyMember | null | undefined = undefined;

    if (createCompanyMemberDto.invitedByMember) {
      const invitedByMemberObject = await this.companyMemberRepository.findById(
        createCompanyMemberDto.invitedByMember.id,
      );
      if (!invitedByMemberObject) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            invitedByMember: 'notExists',
          },
        });
      }
      invitedByMember = invitedByMemberObject;
    } else if (createCompanyMemberDto.invitedByMember === null) {
      invitedByMember = null;
    }

    const roleObject = await this.companyRoleService.findById(
      createCompanyMemberDto.role.id,
    );
    if (!roleObject) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          role: 'notExists',
        },
      });
    }
    const role = roleObject;

    const userObject = await this.userService.findById(
      createCompanyMemberDto.user.id,
    );
    if (!userObject) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          user: 'notExists',
        },
      });
    }
    const user = userObject;

    const companyObject = await this.companyService.findById(
      createCompanyMemberDto.company.id,
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

    return this.companyMemberRepository.create({
      // Do not remove comment below.
      // <creating-property-payload />
      joinedAt: createCompanyMemberDto.joinedAt,

      invitedByMember,

      status: createCompanyMemberDto.status,

      role,

      user,

      company,
    });
  }

  findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }) {
    return this.companyMemberRepository.findAllWithPagination({
      paginationOptions: {
        page: paginationOptions.page,
        limit: paginationOptions.limit,
      },
    });
  }

  findById(id: CompanyMember['id']) {
    return this.companyMemberRepository.findById(id);
  }

  findByIds(ids: CompanyMember['id'][]) {
    return this.companyMemberRepository.findByIds(ids);
  }

  findActiveByUserAndCompany(userId: User['id'], companyId: Company['id']) {
    return this.companyMemberRepository.findActiveByUserAndCompany(
      userId,
      companyId,
    );
  }

  findActiveByUser(userId: User['id']) {
    return this.companyMemberRepository.findActiveByUser(userId);
  }

  async update(
    id: CompanyMember['id'],

    updateCompanyMemberDto: UpdateCompanyMemberDto,
  ) {
    // Do not remove comment below.
    // <updating-property />

    let invitedByMember: CompanyMember | null | undefined = undefined;

    if (updateCompanyMemberDto.invitedByMember) {
      const invitedByMemberObject = await this.companyMemberRepository.findById(
        updateCompanyMemberDto.invitedByMember.id,
      );
      if (!invitedByMemberObject) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            invitedByMember: 'notExists',
          },
        });
      }
      invitedByMember = invitedByMemberObject;
    } else if (updateCompanyMemberDto.invitedByMember === null) {
      invitedByMember = null;
    }

    let role: CompanyRole | undefined = undefined;

    if (updateCompanyMemberDto.role) {
      const roleObject = await this.companyRoleService.findById(
        updateCompanyMemberDto.role.id,
      );
      if (!roleObject) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            role: 'notExists',
          },
        });
      }
      role = roleObject;
    }

    let user: User | undefined = undefined;

    if (updateCompanyMemberDto.user) {
      const userObject = await this.userService.findById(
        updateCompanyMemberDto.user.id,
      );
      if (!userObject) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            user: 'notExists',
          },
        });
      }
      user = userObject;
    }

    let company: Company | undefined = undefined;

    if (updateCompanyMemberDto.company) {
      const companyObject = await this.companyService.findById(
        updateCompanyMemberDto.company.id,
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

    return this.companyMemberRepository.update(id, {
      // Do not remove comment below.
      // <updating-property-payload />
      joinedAt: updateCompanyMemberDto.joinedAt,

      invitedByMember,

      status: updateCompanyMemberDto.status,

      role,

      user,

      company,
    });
  }

  remove(id: CompanyMember['id']) {
    return this.companyMemberRepository.remove(id);
  }
}
