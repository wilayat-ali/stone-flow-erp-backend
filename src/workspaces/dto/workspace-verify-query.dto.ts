import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class WorkspaceVerifyQueryDto {
  @ApiProperty({ example: 'lahore-marble', type: String })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/)
  slug: string;
}
