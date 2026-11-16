import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
import { PURCHASE_STATUSES, PurchaseStatus } from '../purchase.types';

// Far above any real figure; stops typos like an extra five zeros.
const MAX_AMOUNT = 100_000_000_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePurchaseDto {
  @ApiProperty({
    example: '2026-10-08',
    description: 'Calendar day YYYY-MM-DD',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiProperty({ example: 'Ziarat White (rough)' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  material: string;

  @ApiProperty({
    example: '7720',
    description: "Number on the supplier's purchi",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  purchiNo: string;

  @ApiProperty({ example: 'TKR-219' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  truckNo: string;

  @ApiProperty({ example: 21.4, description: 'Tons on the purchi, 2 decimals' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999)
  tons: number;

  @ApiProperty({ example: 6800, description: 'PKR per ton, as on the purchi' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000000)
  ratePerTon: number;

  @ApiPropertyOptional({ example: 520, description: 'Whole PKR taken off' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  discount?: number;

  @ApiProperty({ example: 3, description: 'How many stones it is cut into' })
  @IsInt()
  @Min(1)
  @Max(20)
  stones: number;

  @ApiProperty({ description: 'The factory the truck goes to' })
  @IsUUID()
  factoryId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdatePurchaseDto extends PartialType(CreatePurchaseDto) {}

export class ReasonDto {
  @ApiProperty({ example: 'Wrong weight on the purchi' })
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class ListPurchasesQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_STATUSES })
  @IsOptional()
  @IsIn(PURCHASE_STATUSES)
  status?: PurchaseStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({
    description:
      'Only trucks in stock that have waited at least this many days',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  ageDays?: number;
}
