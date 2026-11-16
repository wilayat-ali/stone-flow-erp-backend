import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  FACTORY_KINDS,
  FactoryKind,
  MACHINE_TYPES,
  MachineType,
  PAY_TYPES,
  PayType,
} from '../settings.types';

// Far above any real rate; stops typos like an extra five zeros.
const MAX_RATE = 100_000_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const name = () => ApiProperty({ example: 'Saadat Marble - Main Factory' });

export class ListQueryDto {
  @ApiPropertyOptional({
    description: 'Also return deactivated rows (default: only active ones)',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}

// ----------------------------------------------------------------- factory

export class CreateFactoryDto {
  @name()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: FACTORY_KINDS })
  @IsIn(FACTORY_KINDS)
  kind: FactoryKind;

  @ApiPropertyOptional({
    nullable: true,
    example: 350,
    description:
      'PKR per ton of cutting. Cutting factories only; ignored for own.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_RATE)
  ratePerTon?: number | null;
}

export class UpdateFactoryDto extends PartialType(CreateFactoryDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ----------------------------------------------------------------- machine

export class CreateMachineDto {
  @ApiProperty({ example: 'Vertical Cutter 1' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: MACHINE_TYPES })
  @IsIn(MACHINE_TYPES)
  type: MachineType;

  @ApiProperty({ description: 'One of the own factories' })
  @IsUUID()
  factoryId: string;

  @ApiProperty({ example: 'Rashid Khan' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  dayThekadar: string;

  @ApiPropertyOptional({ nullable: true, example: 'Bilal Ahmed' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  nightThekadar?: string | null;
}

export class UpdateMachineDto extends PartialType(CreateMachineDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ------------------------------------------- soot sizes, widths, categories

export class CreateCatalogItemDto {
  @ApiProperty({ example: '14 soot' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}

export class UpdateCatalogItemDto extends PartialType(CreateCatalogItemDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ------------------------------------------------------------- worker rate

export class CreateWorkerRateDto {
  @ApiProperty({ example: 'Polisher' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: PAY_TYPES })
  @IsIn(PAY_TYPES)
  payType: PayType;

  @ApiProperty({ example: 10, description: 'PKR per ton, sq.ft, day or month' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_RATE)
  rate: number;
}

export class UpdateWorkerRateDto extends PartialType(CreateWorkerRateDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
