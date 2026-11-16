import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SUPPLIER_TYPES, SupplierType } from '../supplier.types';

// Far above any real balance; stops typos like an extra five zeros.
const MAX_AMOUNT = 100_000_000_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSupplierDto {
  @ApiProperty({ enum: SUPPLIER_TYPES })
  @IsIn(SUPPLIER_TYPES)
  type: SupplierType;

  @ApiProperty({ example: 'Haji Gul Khan' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Ziarat Marble Mines' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  business?: string;

  @ApiProperty({
    example: '0333-7812345',
    description:
      'Pakistani mobile, with or without the dash. Unique per company.',
  })
  @Transform(trim)
  @Matches(/^03\d{2}-?\d{7}$/)
  phone: string;

  @ApiProperty({ example: 'Ziarat' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city: string;

  @ApiPropertyOptional({
    example: 1500,
    nullable: true,
    description:
      'PKR per ton. Required for a cutting factory, ignored otherwise.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  cuttingRatePerTon?: number | null;

  @ApiPropertyOptional({
    example: 120000,
    description:
      'Whole PKR. Positive: we owed them before StoneFlow. Negative: we had paid ahead.',
  })
  @IsOptional()
  @IsInt()
  @Min(-MAX_AMOUNT)
  @Max(MAX_AMOUNT)
  openingBalance?: number;

  @ApiProperty({
    example: '2026-09-01',
    description: 'Calendar day YYYY-MM-DD',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  openingDate: string;
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListSuppliersQueryDto {
  @ApiPropertyOptional({ enum: SUPPLIER_TYPES })
  @IsOptional()
  @IsIn(SUPPLIER_TYPES)
  type?: SupplierType;

  @ApiPropertyOptional({
    enum: ['owe', 'advance'],
    description: 'owe: we owe them. advance: we paid ahead.',
  })
  @IsOptional()
  @IsIn(['owe', 'advance'])
  balance?: 'owe' | 'advance';
}
