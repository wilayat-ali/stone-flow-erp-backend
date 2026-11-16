import { CompanyMember } from '../../company-members/domain/company-member';

import { Account } from '../../accounts/domain/account';
import { Company } from '../../companies/domain/company';
import { Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LedgerEntry {
  @Exclude({ toPlainOnly: true })
  reversedBy?: LedgerEntry | null;

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
    type: () => String,
    nullable: true,
  })
  partyId?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  partyType?: string | null;

  @ApiProperty({
    type: () => Number,
    nullable: false,
  })
  amount: number;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  direction: string;

  @ApiProperty({
    type: () => String,
    example: '2026-11-06',
    nullable: false,
  })
  date: string;

  @Exclude({ toPlainOnly: true })
  account?: Account;

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
