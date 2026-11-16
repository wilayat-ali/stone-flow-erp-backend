import { Company } from '../../companies/domain/company';
import { Exclude } from 'class-transformer';

import { ApiProperty } from '@nestjs/swagger';

export class Account {
  @ApiProperty({
    type: () => Boolean,
    nullable: false,
  })
  isActive: boolean;

  @ApiProperty({
    type: () => String,
    example: '2026-11-06',
    nullable: false,
  })
  openingDate: string;

  @ApiProperty({
    type: () => Number,
    nullable: false,
  })
  openingBalance: number;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  last4?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  name: string;

  @Exclude({ toPlainOnly: true })
  company?: Company;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  kind: string;

  @ApiProperty({
    type: String,
  })
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
