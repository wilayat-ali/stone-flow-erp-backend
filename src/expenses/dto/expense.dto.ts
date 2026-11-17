import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
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
  EXPENSE_STATUSES,
  ExpenseStatus,
  PAY_MODES,
  PayMode,
} from '../expense.types';

const MAX_AMOUNT = 100_000_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateExpenseDto {
  @ApiProperty({ example: '2026-11-03' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ description: 'An expense category from Settings' })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ example: 'Tea and lunch for the cutting crew' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description: string;

  @ApiProperty({ example: 3500, description: 'Whole PKR' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiProperty()
  @IsUUID()
  factoryId: string;

  @ApiProperty({ enum: PAY_MODES })
  @IsIn(PAY_MODES)
  payMode: PayMode;

  @ApiPropertyOptional({
    description: 'Paid now: the account the money leaves',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({
    example: '2026-11-15',
    description: 'Unpaid: when it is due',
  })
  @IsOptional()
  @Matches(DATE)
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Shop credit: the shop that gave it' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ example: 'k-electric-oct.jpg' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  photoName?: string;
}

export class ListExpensesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ enum: PAY_MODES })
  @IsOptional()
  @IsIn(PAY_MODES)
  payMode?: PayMode;

  @ApiPropertyOptional({ enum: EXPENSE_STATUSES })
  @IsOptional()
  @IsIn(EXPENSE_STATUSES)
  status?: ExpenseStatus;

  @ApiPropertyOptional({
    description: 'Part of the number, description, category or shop',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ReasonDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}

export class PayBillDto {
  @ApiProperty({ description: 'The account the bill is paid from' })
  @IsUUID()
  accountId: string;

  @ApiProperty({ example: '2026-11-14' })
  @Matches(DATE)
  date: string;
}

export class GiveMunshiCashDto {
  @ApiProperty({ description: 'The cash or bank account the money comes from' })
  @IsUUID()
  fromAccountId: string;

  @ApiProperty({ example: 20000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiProperty({ example: '2026-11-01' })
  @Matches(DATE)
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}
