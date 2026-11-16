import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { ALL_PERMISSIONS } from '../../tenancy/permissions';

// Lengths, empty names and unknown permissions are checked in the service so
// the UI gets a stable error code (NAME_REQUIRED, INVALID_PERMISSION, ...).
export class RoleInputDto {
  @ApiProperty({ example: 'Accountant' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Keeps the books and pays bills' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    type: [String],
    enum: ALL_PERMISSIONS,
    example: ['dashboard.view', 'expenses.view'],
  })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}

export class RoleViewDto {
  @ApiProperty({ example: 'accountant' })
  key: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: [String] })
  permissions: string[];

  @ApiProperty({
    description: 'One of the five roles every company starts with',
  })
  builtin: boolean;

  @ApiProperty({
    description:
      'Everyone who has the role (any status) plus pending invitations',
  })
  memberCount: number;
}
