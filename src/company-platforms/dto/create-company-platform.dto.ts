import { CompanyDto } from '../../companies/dto/company.dto';

import {
  // decorators here
  Type,
} from 'class-transformer';

import {
  // decorators here

  ValidateNested,
  IsNotEmptyObject,
  IsString,
  IsBoolean,
} from 'class-validator';

import {
  // decorators here
  ApiProperty,
} from '@nestjs/swagger';

export class CreateCompanyPlatformDto {
  @ApiProperty({
    required: true,
    type: () => Boolean,
  })
  @IsBoolean()
  isEnabled: boolean;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  platformKey: string;

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
