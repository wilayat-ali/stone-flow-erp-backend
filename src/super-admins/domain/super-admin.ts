import { ApiProperty } from '@nestjs/swagger';

export class SuperAdmin {
  @ApiProperty({
    type: () => Date,
    nullable: true,
  })
  lastLoginAt?: Date | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  status: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  role: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  passwordHash: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  email: string;

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
