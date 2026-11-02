import { Company } from '../../companies/domain/company';

import { ApiProperty } from '@nestjs/swagger';

export class AuditLog {
  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  metadata?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  targetId?: string | null;

  @ApiProperty({
    type: () => String,
    nullable: true,
  })
  targetType?: string | null;

  @ApiProperty({
    type: () => Company,
    nullable: true,
  })
  company?: Company | null;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  action: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  actorId: string;

  @ApiProperty({
    type: () => String,
    nullable: false,
  })
  actorType: string;

  @ApiProperty({
    type: String,
  })
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
