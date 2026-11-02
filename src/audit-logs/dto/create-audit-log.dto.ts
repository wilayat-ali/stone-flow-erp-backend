import { CompanyDto } from '../../companies/dto/company.dto';

import {
  // decorators here

  IsString,
  ValidateNested,
  IsNotEmptyObject,
  IsOptional,
} from 'class-validator';

import {
  // decorators here
  ApiProperty,
} from '@nestjs/swagger';

import {
  // decorators here
  Type,
} from 'class-transformer';

export class CreateAuditLogDto {
  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  metadata?: string | null;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  targetId?: string | null;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  targetType?: string | null;

  @ApiProperty({
    required: false,
    type: () => CompanyDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyDto)
  @IsNotEmptyObject()
  company?: CompanyDto | null;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  action: string;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  actorId: string;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  actorType: string;

  // Don't forget to use the class-validator decorators in the DTO properties.
}
