import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { ItemDto } from '../../inventory/dto/inventory.dto';
import {
  DIRECTIONS,
  Direction,
  ENTRY_TYPES,
  EntryType,
} from '../production.types';

const MAX_QTY = 100_000_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class EntryLineDto {
  @ApiProperty({
    enum: DIRECTIONS,
    description: 'in comes out of stock, out goes into stock',
  })
  @IsIn(DIRECTIONS)
  direction: Direction;

  @ApiProperty({ type: ItemDto })
  @ValidateNested()
  @Type(() => ItemDto)
  item: ItemDto;

  @ApiProperty({ example: 40 })
  @IsInt()
  @Min(0)
  @Max(MAX_QTY)
  qty: number;

  @ApiPropertyOptional({ description: 'Counters: total inches of length' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_QTY)
  inches?: number;
}

export class CreateProductionEntryDto {
  @ApiProperty({ enum: ENTRY_TYPES })
  @IsIn(ENTRY_TYPES)
  type: EntryType;

  @ApiProperty({ example: '2026-10-09' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ description: 'The factory the work is done in' })
  @IsUUID()
  factoryId: string;

  @ApiProperty({ example: 'Ziarat White' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  material: string;

  @ApiPropertyOptional({ description: 'A cutting-output entry: the truck' })
  @IsOptional()
  @IsUUID()
  purchaseId?: string;

  @ApiPropertyOptional({ example: 'vertical' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  machineType?: string;

  @ApiPropertyOptional({
    description: 'The worker paid per sq.ft for the step',
  })
  @IsOptional()
  @IsUUID()
  workerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ type: [EntryLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EntryLineDto)
  lines: EntryLineDto[];
}

export class ListProductionEntriesQueryDto {
  @ApiPropertyOptional({ enum: ENTRY_TYPES })
  @IsOptional()
  @IsIn(ENTRY_TYPES)
  type?: EntryType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  material?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DATE)
  to?: string;
}

export class SendToMachineDto {
  @ApiProperty({ description: 'A machine of the factory the truck is in' })
  @IsUUID()
  machineId: string;

  @ApiProperty({ example: 'Rashid Khan' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  thekadarName: string;

  @ApiProperty({ example: '2026-10-09' })
  @Matches(DATE)
  date: string;
}

export class StartCuttingDto {
  @ApiProperty({ example: '2026-10-09' })
  @Matches(DATE)
  date: string;
}

export class FinishCuttingDto {
  @ApiProperty({ example: '2026-10-12' })
  @Matches(DATE)
  date: string;

  @ApiPropertyOptional({
    example: 1100,
    description:
      'Our own factory: what the thekadar earns per ton. At another factory the factory rate applies.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  ratePerTon?: number;
}
