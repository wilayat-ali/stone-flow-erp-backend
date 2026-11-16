import { Company } from '../../companies/domain/company';
import { Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PartyLedgerEntry {
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
  credit?: number | null;

  @ApiProperty({
    type: () => Number,
    nullable: true,
  })
  charge?: number | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  partyId: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  partyType: string;

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
