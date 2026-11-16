import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PAYMENT_METHODS, PaymentMethod } from '../supplier-payment.types';

// Far above any real payment; stops typos like an extra five zeros.
const MAX_AMOUNT = 100_000_000_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSupplierPaymentDto {
  @ApiProperty({
    example: '2026-10-08',
    description: 'Calendar day YYYY-MM-DD',
  })
  @Matches(DATE)
  date: string;

  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;

  @ApiProperty({
    description:
      'Cash: a cash account. Bank transfer or cheque: the bank account it leaves.',
  })
  @IsUUID()
  accountId: string;

  @ApiProperty({ example: 160000, description: 'Whole PKR' })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiPropertyOptional({
    example: 'IBFT 551207',
    description: 'Bank transfer reference',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({
    example: '445125',
    description: 'Required for a cheque',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  chequeNo?: string;

  @ApiPropertyOptional({
    example: '2026-10-14',
    description: 'The date written on the cheque. Required for a cheque.',
  })
  @IsOptional()
  @Matches(DATE)
  chequeDate?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Trucks this payment is for; the rest goes to the oldest unpaid ones',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  forPurchaseIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'The bounced or returned cheque this one replaces',
  })
  @IsOptional()
  @IsUUID()
  replacesChequeId?: string;
}

export class RejectPaymentDto {
  @ApiPropertyOptional({ example: 'Wrong amount' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ClearChequeDto {
  @ApiProperty({ example: '2026-10-15', description: 'The day it cleared' })
  @Matches(DATE)
  date: string;
}

export class BounceChequeDto {
  @ApiProperty({ example: '2026-10-15', description: 'The day it bounced' })
  @Matches(DATE)
  date: string;

  @ApiPropertyOptional({ example: 'Signature mismatch' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    example: 500,
    description: 'Bank charge in whole PKR',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  charge?: number;
}
