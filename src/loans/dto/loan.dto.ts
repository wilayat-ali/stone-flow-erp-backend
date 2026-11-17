import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const MAX_AMOUNT = 100_000_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class GiveLoanDto {
  @ApiProperty()
  @IsUUID()
  workerId: string;

  @ApiProperty({ example: '2026-10-05' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ example: 30000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiProperty({ example: 5000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  monthlyInstalment: number;

  @ApiProperty({ example: '2026-11', description: 'The first month to deduct' })
  @Matches(MONTH)
  firstMonth: string;

  @ApiProperty({ example: 0, description: 'Repaid before StoneFlow' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  priorRepaid: number;

  @ApiPropertyOptional({
    description:
      'The cash or bank account the money leaves. Leave out for a loan given before StoneFlow.',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ example: 'Family wedding' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class InstalmentChangeDto {
  @ApiPropertyOptional({ description: 'Another amount for the month' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount?: number;

  @ApiPropertyOptional({ description: 'Skip the month' })
  @IsOptional()
  @IsBoolean()
  skip?: boolean;
}
