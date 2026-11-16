import { CompanyMember } from '../../company-members/domain/company-member';

import { Company } from '../../companies/domain/company';
import { Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class Approval {
  @ApiProperty({
    type: () => Object,
    nullable: true,
  })
  payload?: Record<string, unknown> | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  reason?: string | null;

  @ApiProperty({
    type: () => Date,
    nullable: true,
  })
  decidedAt?: Date | null;

  @Exclude({ toPlainOnly: true })
  decidedByMember?: CompanyMember | null;

  @Exclude({ toPlainOnly: true })
  requestedByMember?: CompanyMember;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  status: string;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  entityId?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  entityType: string;

  @Exclude({ toPlainOnly: true })
  company?: Company;

  @ApiProperty({
    type: String,
  })
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
