import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CUSTOMER_TYPES,
  CustomerType,
  JOB_STATUSES,
  JobStatus,
} from '../customer.types';

const MAX_AMOUNT = 100_000_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCustomerDto {
  @ApiProperty({ example: 'ABC Builders' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '0300-2145678', description: 'Unique per company.' })
  @Transform(trim)
  @Matches(/^03\d{2}-?\d{7}$/)
  phone: string;

  @ApiProperty({ enum: CUSTOMER_TYPES })
  @IsIn(CUSTOMER_TYPES)
  type: CustomerType;

  @ApiPropertyOptional({ example: 'Karachi' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'Faisal Qureshi' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  contactPerson?: string;

  @ApiPropertyOptional({
    description: 'Udhaar from before StoneFlow (owner and partner only).',
  })
  @IsOptional()
  @IsInt()
  @Min(-MAX_AMOUNT)
  @Max(MAX_AMOUNT)
  openingBalance?: number;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DATE)
  openingDate?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ enum: CUSTOMER_TYPES })
  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  type?: CustomerType;

  @ApiPropertyOptional({ enum: ['due', 'old30', 'advance'] })
  @IsOptional()
  @IsIn(['due', 'old30', 'advance'])
  balance?: 'due' | 'old30' | 'advance';
}

export class ReceiveJobDto {
  @ApiPropertyOptional({
    description:
      'An existing customer. Leave out to add one from name + phone.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 'Haji Saleem' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '0300-5512398' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^03\d{2}-?\d{7}$/)
  phone?: string;

  @ApiProperty({ example: '2026-10-09' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ example: 'KHT-611' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  truckNo: string;

  @ApiProperty({ example: 'Ziarat Grey' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  material: string;

  @ApiProperty({ example: 11.2 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000)
  tons: number;

  @ApiProperty({ description: 'The factory the truck is cut in' })
  @IsUUID()
  factoryId: string;

  @ApiProperty({ example: 35 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000)
  ratePerSqft: number;
}

export class SendJobDto {
  @ApiProperty()
  @IsUUID()
  machineId: string;

  @ApiProperty({ example: 'Aslam Baig' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  thekadarName: string;

  @ApiProperty({ example: '2026-10-10' })
  @Matches(DATE)
  date: string;
}

export class FinishJobDto {
  @ApiProperty({ example: '2026-10-14' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ example: 720 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  sqft: number;

  @ApiProperty({ example: 35 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  ratePerSqft: number;

  @ApiPropertyOptional({ example: '14 soot 12x24 and 12x12' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  outputNote?: string;

  @ApiPropertyOptional({
    example: 1100,
    description: 'What the thekadar earns per ton for this truck.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  ratePerTon?: number;
}

export class ListJobsQueryDto {
  @ApiPropertyOptional({ enum: JOB_STATUSES })
  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: JobStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
