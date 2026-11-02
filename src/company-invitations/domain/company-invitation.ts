import { CompanyMember } from '../../company-members/domain/company-member';

import { User } from '../../users/domain/user';

import { CompanyRole } from '../../company-roles/domain/company-role';

import { Company } from '../../companies/domain/company';

import { ApiProperty } from '@nestjs/swagger';

export class CompanyInvitation {
  @ApiProperty({
    type: () => Date,
    nullable: true,
  })
  acceptedAt?: Date | null;

  @ApiProperty({
    type: () => CompanyMember,
    nullable: true,
  })
  invitedByMember?: CompanyMember | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  status: string;

  @ApiProperty({
    type: () => Date,
    nullable: false,
  })
  expiresAt: Date;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  tokenHash: string;

  @ApiProperty({
    type: () => User,
    nullable: true,
  })
  user?: User | null;

  @ApiProperty({
    type: () => CompanyRole,
    nullable: true,
  })
  role?: CompanyRole | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  email?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  phone?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  type: string;

  @ApiProperty({
    type: () => Company,
    nullable: false,
  })
  company: Company;

  @ApiProperty({
    type: String,
  })
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
