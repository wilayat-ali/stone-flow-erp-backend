import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  ValidateNested,
} from 'class-validator';
import {
  ADJUSTMENT_REASONS,
  AdjustmentReason,
  ENTRY_TYPES,
  EntryType,
  FINISHES,
  Finish,
  ITEM_TYPES,
} from '../inventory.types';

const MAX_QTY = 100_000_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const bool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true;

// An item the way the screens name it. Materials, soot types and sizes are
// looked up by name: a new material or piece size is added the first time
// someone counts stock in it.
export class ItemDto {
  @ApiProperty({ enum: ITEM_TYPES })
  @IsIn(ITEM_TYPES)
  itemType: 'piece' | 'counter' | 'slab';

  @ApiProperty({ description: 'The factory the stock is in' })
  @IsUUID()
  factoryId: string;

  @ApiProperty({ example: 'Ziarat White' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  material: string;

  @ApiPropertyOptional({
    example: '14',
    description: 'Pieces: the soot type (14, 6, 4)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  soot?: string;

  @ApiPropertyOptional({
    example: '12x24',
    description: 'Pieces: width x length in inches',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  size?: string;

  @ApiPropertyOptional({
    example: 2,
    description: 'Counters: the width in inches',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  width?: number;

  @ApiPropertyOptional({ enum: FINISHES, description: 'Pieces and counters' })
  @IsOptional()
  @IsIn(FINISHES)
  finish?: Finish;
}

export class CreateStockEntryDto {
  @ApiProperty({ enum: ENTRY_TYPES })
  @IsIn(ENTRY_TYPES)
  type: EntryType;

  @ApiProperty({ example: '2026-10-09' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @ApiPropertyOptional({
    enum: [1, -1],
    description: 'Adjustments only: 1 adds, -1 removes. Opening always adds.',
  })
  @IsOptional()
  @IsIn([1, -1])
  direction?: 1 | -1;

  @ApiPropertyOptional({
    enum: ADJUSTMENT_REASONS,
    description: 'Required for an adjustment',
  })
  @IsOptional()
  @IsIn(ADJUSTMENT_REASONS)
  reason?: AdjustmentReason;

  @ApiPropertyOptional({ description: 'Required when the reason is "other"' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ type: ItemDto })
  @ValidateNested()
  @Type(() => ItemDto)
  item: ItemDto;

  @ApiProperty({ example: 4, description: 'Pieces, counter pieces or slabs' })
  @IsInt()
  @Min(1)
  @Max(MAX_QTY)
  qty: number;

  @ApiPropertyOptional({
    example: 96,
    description: 'Counters: total inches of length',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QTY)
  inches?: number;

  @ApiPropertyOptional({ description: 'A transfer: the factory it moves to' })
  @IsOptional()
  @IsUUID()
  toFactoryId?: string;
}

export class RejectEntryDto {
  @ApiProperty({ example: 'Count was already corrected' })
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class ListEntriesQueryDto {
  @ApiPropertyOptional({ enum: ENTRY_TYPES })
  @IsOptional()
  @IsIn(ENTRY_TYPES)
  type?: EntryType;

  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';
}

export class SetAlertDto {
  @ApiProperty({ type: ItemDto })
  @ValidateNested()
  @Type(() => ItemDto)
  item: ItemDto;

  @ApiProperty({
    example: 200,
    description: 'Below this the item shows as low. 0 removes the alert.',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_QTY)
  minQty: number;
}

export class StockQueryDto {
  @ApiPropertyOptional({ enum: ITEM_TYPES })
  @IsOptional()
  @IsIn(ITEM_TYPES)
  type?: 'piece' | 'counter' | 'slab';

  @ApiPropertyOptional({ description: 'Material id' })
  @IsOptional()
  @IsUUID()
  material?: string;

  @ApiPropertyOptional({ description: 'Soot type id' })
  @IsOptional()
  @IsUUID()
  soot?: string;

  @ApiPropertyOptional({ description: 'Piece size id' })
  @IsOptional()
  @IsUUID()
  size?: string;

  @ApiPropertyOptional({ description: 'Counter width id' })
  @IsOptional()
  @IsUUID()
  width?: string;

  @ApiPropertyOptional({ enum: FINISHES })
  @IsOptional()
  @IsIn(FINISHES)
  finish?: Finish;

  @ApiPropertyOptional({ description: 'Factory id' })
  @IsOptional()
  @IsUUID()
  factory?: string;

  @ApiPropertyOptional({ description: 'Only items below their alert level' })
  @IsOptional()
  @Transform(bool)
  lowOnly?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 200,
    description: 'Rows per page (at most 200)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
