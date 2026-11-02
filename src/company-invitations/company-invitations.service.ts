import { CompanyMembersService } from '../company-members/company-members.service';
import { CompanyMember } from '../company-members/domain/company-member';

import { UsersService } from '../users/users.service';
import { User } from '../users/domain/user';

import { CompanyRolesService } from '../company-roles/company-roles.service';
import { CompanyRole } from '../company-roles/domain/company-role';

import { Company } from '../companies/domain/company';
import { CompaniesService } from '../companies/companies.service';
import {
  // common
  Injectable,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateCompanyInvitationDto } from './dto/create-company-invitation.dto';
import { UpdateCompanyInvitationDto } from './dto/update-company-invitation.dto';
import { CompanyInvitationRepository } from './infrastructure/persistence/company-invitation.repository';
import { IPaginationOptions } from '../utils/types/pagination-options';
import { CompanyInvitation } from './domain/company-invitation';

@Injectable()
export class CompanyInvitationsService {
  constructor(
    private readonly companyMemberService: CompanyMembersService,

    private readonly userService: UsersService,

    private readonly companyRoleService: CompanyRolesService,

    private readonly companyService: CompaniesService,

    // Dependencies here
    private readonly companyInvitationRepository: CompanyInvitationRepository,
  ) {}

  async create(createCompanyInvitationDto: CreateCompanyInvitationDto) {
    // Do not remove comment below.
    // <creating-property />

    let invitedByMember: CompanyMember | null | undefined = undefined;

    if (createCompanyInvitationDto.invitedByMember) {
      const invitedByMemberObject = await this.companyMemberService.findById(
        createCompanyInvitationDto.invitedByMember.id,
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
    } else if (createCompanyInvitationDto.invitedByMember === null) {
      invitedByMember = null;
    }

    let user: User | null | undefined = undefined;

    if (createCompanyInvitationDto.user) {
      const userObject = await this.userService.findById(
        createCompanyInvitationDto.user.id,
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
    } else if (createCompanyInvitationDto.user === null) {
      user = null;
    }

    let role: CompanyRole | null | undefined = undefined;

    if (createCompanyInvitationDto.role) {
      const roleObject = await this.companyRoleService.findById(
        createCompanyInvitationDto.role.id,
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
    } else if (createCompanyInvitationDto.role === null) {
      role = null;
    }

    const companyObject = await this.companyService.findById(
      createCompanyInvitationDto.company.id,
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

    return this.companyInvitationRepository.create({
      // Do not remove comment below.
      // <creating-property-payload />
      acceptedAt: createCompanyInvitationDto.acceptedAt,

      invitedByMember,

      status: createCompanyInvitationDto.status,

      expiresAt: createCompanyInvitationDto.expiresAt,

      tokenHash: createCompanyInvitationDto.tokenHash,

      user,

      role,

      email: createCompanyInvitationDto.email,

      phone: createCompanyInvitationDto.phone,

      type: createCompanyInvitationDto.type,

      company,
    });
  }

  findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }) {
    return this.companyInvitationRepository.findAllWithPagination({
      paginationOptions: {
        page: paginationOptions.page,
        limit: paginationOptions.limit,
      },
    });
  }

  findById(id: CompanyInvitation['id']) {
    return this.companyInvitationRepository.findById(id);
  }

  findByIds(ids: CompanyInvitation['id'][]) {
    return this.companyInvitationRepository.findByIds(ids);
  }

  async update(
    id: CompanyInvitation['id'],

    updateCompanyInvitationDto: UpdateCompanyInvitationDto,
  ) {
    // Do not remove comment below.
    // <updating-property />

    let invitedByMember: CompanyMember | null | undefined = undefined;

    if (updateCompanyInvitationDto.invitedByMember) {
      const invitedByMemberObject = await this.companyMemberService.findById(
        updateCompanyInvitationDto.invitedByMember.id,
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
    } else if (updateCompanyInvitationDto.invitedByMember === null) {
      invitedByMember = null;
    }

    let user: User | null | undefined = undefined;

    if (updateCompanyInvitationDto.user) {
      const userObject = await this.userService.findById(
        updateCompanyInvitationDto.user.id,
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
    } else if (updateCompanyInvitationDto.user === null) {
      user = null;
    }

    let role: CompanyRole | null | undefined = undefined;

    if (updateCompanyInvitationDto.role) {
      const roleObject = await this.companyRoleService.findById(
        updateCompanyInvitationDto.role.id,
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
    } else if (updateCompanyInvitationDto.role === null) {
      role = null;
    }

    let company: Company | undefined = undefined;

    if (updateCompanyInvitationDto.company) {
      const companyObject = await this.companyService.findById(
        updateCompanyInvitationDto.company.id,
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

    return this.companyInvitationRepository.update(id, {
      // Do not remove comment below.
      // <updating-property-payload />
      acceptedAt: updateCompanyInvitationDto.acceptedAt,

      invitedByMember,

      status: updateCompanyInvitationDto.status,

      expiresAt: updateCompanyInvitationDto.expiresAt,

      tokenHash: updateCompanyInvitationDto.tokenHash,

      user,

      role,

      email: updateCompanyInvitationDto.email,

      phone: updateCompanyInvitationDto.phone,

      type: updateCompanyInvitationDto.type,

      company,
    });
  }

  remove(id: CompanyInvitation['id']) {
    return this.companyInvitationRepository.remove(id);
  }
}
