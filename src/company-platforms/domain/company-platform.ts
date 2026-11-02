import { Company } from '../../companies/domain/company';

import { ApiProperty } from '@nestjs/swagger';

export class CompanyPlatform {
  @ApiProperty({
    type: () => Boolean,
    nullable: false,
  })
  isEnabled: boolean;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  platformKey: string;

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
