import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { COMPANY_STATUS } from '../../tenancy/tenancy.constants';

export class ListCompaniesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @Transform(({ value }) => (value ? Number(value) : 20))
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ enum: Object.values(COMPANY_STATUS) })
  @IsOptional()
  @IsIn(Object.values(COMPANY_STATUS))
  status?: string;

  @ApiPropertyOptional({ description: 'Matches name or slug' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class SetPlatformDto {
  @ApiProperty()
  @IsBoolean()
  isEnabled: boolean;
}
