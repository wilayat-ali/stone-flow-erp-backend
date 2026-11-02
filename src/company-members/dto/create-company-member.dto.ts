import { CompanyMemberDto } from './company-member.dto';

import { CompanyRoleDto } from '../../company-roles/dto/company-role.dto';

import { UserDto } from '../../users/dto/user.dto';

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

export class CreateCompanyMemberDto {
  @ApiProperty({
    required: false,
    type: () => Date,
  })
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  @IsDate()
  joinedAt?: Date | null;

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
    type: () => CompanyRoleDto,
  })
  @ValidateNested()
  @Type(() => CompanyRoleDto)
  @IsNotEmptyObject()
  role: CompanyRoleDto;

  @ApiProperty({
    required: true,
    type: () => UserDto,
  })
  @ValidateNested()
  @Type(() => UserDto)
  @IsNotEmptyObject()
  user: UserDto;

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
