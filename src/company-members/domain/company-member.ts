import { CompanyRole } from '../../company-roles/domain/company-role';

import { User } from '../../users/domain/user';

import { Company } from '../../companies/domain/company';

import { ApiProperty } from '@nestjs/swagger';

export class CompanyMember {
  @ApiProperty({
    type: () => Date,
    nullable: true,
  })
  joinedAt?: Date | null;

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
    type: () => CompanyRole,
    nullable: false,
  })
  role: CompanyRole;

  @ApiProperty({
    type: () => User,
    nullable: false,
  })
  user: User;

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
