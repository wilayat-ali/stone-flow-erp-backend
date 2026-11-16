import { UserDto } from '../../users/dto/user.dto';

import {
  // decorators here

  IsString,
  ValidateNested,
  IsNotEmptyObject,
  IsOptional,
  IsBoolean,
} from 'class-validator';

import {
  // decorators here
  ApiProperty,
} from '@nestjs/swagger';

import {
  // decorators here
  Type,
} from 'class-transformer';

export class CreateCompanyDto {
  theme?: string | null;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  currency: string;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  parchiLanguage: string;

  @ApiProperty({
    required: true,
    type: () => Boolean,
  })
  @IsBoolean()
  approvalRequired: boolean;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  ntn?: string | null;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  address?: string | null;

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
  status: string;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  slug: string;

  @ApiProperty({
    required: true,
    type: () => UserDto,
  })
  @ValidateNested()
  @Type(() => UserDto)
  @IsNotEmptyObject()
  ownerUser: UserDto;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  name: string;

  // Don't forget to use the class-validator decorators in the DTO properties.
}
