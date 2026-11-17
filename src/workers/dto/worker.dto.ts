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
import { PAY_TYPES, PayType } from '../worker.types';

// Far above any real balance; stops typos like an extra five zeros.
const MAX_AMOUNT = 100_000_000_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateWorkerDto {
  @ApiProperty({ example: 'Rashid Khan' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: '0300-1112233' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: 'Thekadar' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  jobTitle?: string;

  @ApiProperty({ description: 'The factory they work in' })
  @IsUUID()
  factoryId: string;

  @ApiProperty({ enum: PAY_TYPES })
  @IsIn(PAY_TYPES)
  payType: PayType;

  @ApiProperty({
    example: 1100,
    description:
      'PKR per ton, per sq.ft, per day or per month. A sq.ft worker with 0 is paid by the rate card.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  rate: number;

  @ApiPropertyOptional({
    example: 'Polisher',
    description: 'A sq.ft worker: the rate-card job they are paid by',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  defaultJob?: string;

  @ApiPropertyOptional({
    example: 4000,
    description: 'What we owed them (positive) or they owed us (negative)',
  })
  @IsOptional()
  @IsInt()
  @Min(-MAX_AMOUNT)
  @Max(MAX_AMOUNT)
  openingBalance?: number;

  @ApiProperty({ example: '2026-09-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  joinedOn: string;
}

export class UpdateWorkerDto extends PartialType(CreateWorkerDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListWorkersQueryDto {
  @ApiPropertyOptional({ enum: PAY_TYPES })
  @IsOptional()
  @IsIn(PAY_TYPES)
  payType?: PayType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ description: 'Part of a name or phone number' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}
