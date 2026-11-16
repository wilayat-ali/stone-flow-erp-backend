import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { THEME_KEYS } from '../../tenancy/tenancy.constants';

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

  @ApiProperty({
    example: 'munshi',
    description: 'The key of any role of the company (not owner)',
  })
  @IsString()
  @IsNotEmpty()
  roleKey: string;
}

export class ChangeMemberRoleDto {
  @ApiProperty({
    example: 'manager',
    description: 'The key of any role of the company (not owner)',
  })
  @IsString()
  @IsNotEmpty()
  roleKey: string;
}

export class ChangeSettingsDto {
  @ApiProperty({
    example: true,
    description:
      "When on, a Munshi's purchase, payment and stock entries wait for approval",
  })
  @IsBoolean()
  approvalRequired: boolean;
}

export class ChangeBrandingDto {
  @ApiProperty({ enum: THEME_KEYS, example: 'violet-bloom' })
  @IsIn(THEME_KEYS)
  theme: string;
}
