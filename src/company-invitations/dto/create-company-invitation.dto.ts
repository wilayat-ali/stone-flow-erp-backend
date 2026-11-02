import { CompanyMemberDto } from '../../company-members/dto/company-member.dto';

import { UserDto } from '../../users/dto/user.dto';

import { CompanyRoleDto } from '../../company-roles/dto/company-role.dto';

import { CompanyDto } from '../../companies/dto/company.dto';

import {
  // decorators here
  Type,
  Transform,
} from 'class-transformer';

import {
  // decorators here

  ValidateNested,
  IsNotEmptyObject,
  IsString,
  IsOptional,
  IsDate,
} from 'class-validator';

import {
  // decorators here
  ApiProperty,
} from '@nestjs/swagger';

export class CreateCompanyInvitationDto {
  @ApiProperty({
    required: false,
    type: () => Date,
  })
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  @IsDate()
  acceptedAt?: Date | null;

  @ApiProperty({
    required: false,
    type: () => CompanyMemberDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyMemberDto)
  @IsNotEmptyObject()
  invitedByMember?: CompanyMemberDto | null;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  status: string;

  @ApiProperty({
    required: true,
    type: () => Date,
  })
  @Transform(({ value }) => new Date(value))
  @IsDate()
  expiresAt: Date;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  tokenHash: string;

  @ApiProperty({
    required: false,
    type: () => UserDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserDto)
  @IsNotEmptyObject()
  user?: UserDto | null;

  @ApiProperty({
    required: false,
    type: () => CompanyRoleDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyRoleDto)
  @IsNotEmptyObject()
  role?: CompanyRoleDto | null;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  email?: string | null;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  phone?: string | null;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  type: string;

  @ApiProperty({
    required: true,
    type: () => CompanyDto,
  })
  @ValidateNested()
  @Type(() => CompanyDto)
  @IsNotEmptyObject()
  company: CompanyDto;

  // Don't forget to use the class-validator decorators in the DTO properties.
}
