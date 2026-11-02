import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class AuthWorkspaceLoginDto {
  @ApiProperty({ example: 'lahore-marble', type: String })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/)
  slug: string;

  @ApiProperty({
    example: '03001234567',
    description: 'Phone (03XX…, +92…) or email',
    type: String,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty({ example: 'secret', type: String })
  @IsString()
  @IsNotEmpty()
  password: string;
}
