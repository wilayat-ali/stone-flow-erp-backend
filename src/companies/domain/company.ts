import { User } from '../../users/domain/user';

import { ApiProperty } from '@nestjs/swagger';

export class Company {
  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  currency: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  parchiLanguage: string;

  @ApiProperty({
    type: () => Boolean,
    nullable: false,
  })
  approvalRequired: boolean;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  ntn?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  address?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  phone?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  status: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  slug: string;

  @ApiProperty({
    type: () => User,
    nullable: false,
  })
  ownerUser: User;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  name: string;

  @ApiProperty({
    type: String,
  })
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
