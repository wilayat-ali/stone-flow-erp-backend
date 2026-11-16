import { CompanyMember } from '../../company-members/domain/company-member';

import { Company } from '../../companies/domain/company';
import { Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class StockMovement {
  @Exclude({ toPlainOnly: true })
  createdByMember?: CompanyMember;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  note?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  sourceId?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  sourceType: string;

  @ApiProperty({
    type: () => Number,
    nullable: true,
  })
  inches?: number | null;

  @ApiProperty({
    type: () => Number,
    nullable: false,
  })
  qty: number;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  finish?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  counterWidthId?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  sootSizeId?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  sootTypeId?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  materialId: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  itemType: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  factoryId: string;

  @ApiProperty({
    type: () => String,
    example: '2026-11-06',
    nullable: false,
  })
  date: string;

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
