import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { COMPANY_ROLE_KEYS } from '../../tenancy/tenancy.constants';

export class InviteMemberDto {
  @ApiPropertyOptional({
    example: '03001234567',
    description: 'Phone or email is required',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'munshi@example.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ enum: COMPANY_ROLE_KEYS, example: 'munshi' })
  @IsIn(COMPANY_ROLE_KEYS)
  roleKey: string;
}

export class ChangeMemberRoleDto {
  @ApiProperty({ enum: COMPANY_ROLE_KEYS, example: 'manager' })
  @IsIn(COMPANY_ROLE_KEYS)
  roleKey: string;
}
