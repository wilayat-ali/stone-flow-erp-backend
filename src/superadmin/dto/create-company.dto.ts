import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { IsSlug } from '../../tenancy/is-slug.decorator';
import { PLATFORM_KEYS, PlatformKey } from '../../tenancy/tenancy.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CompanyOwnerDto {
  @ApiProperty({ example: 'Ahmed', type: String })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  firstName: string;

  @ApiPropertyOptional({ example: 'Khan', type: String })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 80)
  lastName?: string;

  @ApiPropertyOptional({
    example: '03001234567',
    description: 'Phone or email is required',
    type: String,
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'owner@example.com', type: String })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class CreateCompanyDto {
  @ApiProperty({ example: 'Lahore Marble Works', type: String })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({
    example: 'lahore-marble',
    description: 'a-z, 0-9 and hyphen, 3-40 characters; reserved words blocked',
    type: String,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsSlug()
  slug: string;

  @ApiPropertyOptional({ type: String })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(3, 30)
  phone?: string;

  @ApiPropertyOptional({ type: String })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 300)
  address?: string;

  @ApiPropertyOptional({ type: String })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 30)
  ntn?: string;

  @ApiProperty({ enum: PLATFORM_KEYS, isArray: true, example: ['factory'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PLATFORM_KEYS, { each: true })
  platforms: PlatformKey[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;

  @ApiPropertyOptional({ enum: ['ur', 'en', 'en_ur'], default: 'en_ur' })
  @IsOptional()
  @IsIn(['ur', 'en', 'en_ur'])
  parchiLanguage?: 'ur' | 'en' | 'en_ur';

  @ApiPropertyOptional({ example: 'PKR', default: 'PKR' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiProperty({ type: () => CompanyOwnerDto })
  @ValidateNested()
  @Type(() => CompanyOwnerDto)
  owner: CompanyOwnerDto;
}
