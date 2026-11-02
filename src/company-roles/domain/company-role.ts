import { Company } from '../../companies/domain/company';

import { ApiProperty } from '@nestjs/swagger';

export class CompanyRole {
  @ApiProperty({
    type: () => Boolean,
    nullable: false,
  })
  isSystem: boolean;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  key: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  name: string;

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
