import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
  LEDGER_DIRECTIONS,
  LedgerDirection,
} from '../../ledger-entries/ledger.types';

// Far above any real factory; stops typos like an extra five zeros.
const MAX_AMOUNT = 100_000_000_000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const dateField = () =>
  ApiProperty({
    example: '2026-11-06',
    description: 'Calendar day YYYY-MM-DD',
  });

export class CreateAccountDto {
  @ApiProperty({ enum: ['cash', 'bank'] })
  @IsIn(['cash', 'bank'])
  kind: 'cash' | 'bank';

  @ApiProperty({ example: 'HBL Current' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    example: '4471',
    description: 'Last 4 digits of the bank account number (banks only)',
  })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{4}$/)
  last4?: string;

  @ApiProperty({
    example: 250000,
    description:
      'Whole PKR; negative for an overdraft. Posted as an opening row.',
  })
  @IsInt()
  @Min(-MAX_AMOUNT)
  @Max(MAX_AMOUNT)
  openingBalance: number;

  @dateField()
  @Matches(DATE)
  openingDate: string;
}

// The opening balance and date can never be edited: they are ledger history.
export class UpdateAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{4}$/)
  last4?: string;

  @ApiPropertyOptional({
    description: 'false hides the account; never deleted',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TransferDto {
  @ApiProperty()
  @IsUUID()
  fromAccountId: string;

  @ApiProperty()
  @IsUUID()
  toAccountId: string;

  @ApiProperty({ example: 50000 })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @dateField()
  @Matches(DATE)
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

// Cash in hand to a bank. The source is always the company's cash account.
export class DepositDto {
  @ApiProperty({ description: 'The bank account receiving the cash' })
  @IsUUID()
  toAccountId: string;

  @ApiPropertyOptional({
    description:
      'The cash account the money leaves. Omit it to use the default (oldest active cash account).',
  })
  @IsOptional()
  @IsUUID()
  fromAccountId?: string;

  @ApiProperty({ example: 50000 })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @dateField()
  @Matches(DATE)
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

// Other Payment (money out) or Other Receipt (money in) on one account.
export class MoneyEntryDto {
  @ApiProperty()
  @IsUUID()
  accountId: string;

  @ApiProperty({ example: 1500 })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @dateField()
  @Matches(DATE)
  date: string;

  @ApiPropertyOptional({ example: 'Electricity bill' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CashCountDto {
  @ApiPropertyOptional({
    description:
      'The cash account being counted. Omit it to count the default (oldest active cash account).',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiProperty({
    example: 125000,
    description: 'Cash actually counted, whole PKR',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  countedAmount: number;

  @dateField()
  @Matches(DATE)
  date: string;

  @ApiPropertyOptional({ description: 'Required whenever the count differs' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ReverseEntryDto {
  @dateField()
  @Matches(DATE)
  date: string;

  @ApiProperty({ example: 'Entered on the wrong account' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason: string;
}

export class RejectDto {
  @ApiProperty({ example: 'Amount does not match the slip' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}

export class StatementQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(DATE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(DATE)
  to?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ example: 'other_payment' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{0,49}$/)
  sourceType?: string;

  @ApiPropertyOptional({ enum: LEDGER_DIRECTIONS })
  @IsOptional()
  @IsIn(LEDGER_DIRECTIONS)
  direction?: LedgerDirection;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListApprovalsQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListAccountsQueryDto {
  @ApiPropertyOptional({ description: 'Also return deactivated accounts' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}
