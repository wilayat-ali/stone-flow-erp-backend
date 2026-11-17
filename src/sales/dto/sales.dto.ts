import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { CUSTOMER_TYPES, CustomerType } from '../../customers/customer.types';
import { ItemDto } from '../../inventory/dto/inventory.dto';
import { PAYMENT_METHODS, PaymentMethod } from '../sales.types';

const MAX_QTY = 100_000_000;
const MAX_AMOUNT = 100_000_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SaleLineDto {
  @ApiPropertyOptional({
    description: 'Kept when a bill is edited, so collections still point at it',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  lineNo?: number;

  @ApiProperty({ type: ItemDto })
  @ValidateNested()
  @Type(() => ItemDto)
  item: ItemDto;

  @ApiProperty({ example: 40 })
  @IsInt()
  @Min(0)
  @Max(MAX_QTY)
  qty: number;

  @ApiPropertyOptional({ description: 'Counters: total inches' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_QTY)
  inches?: number;

  @ApiPropertyOptional({ description: 'Slabs: kanta weight in tons' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  tons?: number;

  @ApiProperty({
    description: 'PKR per sq.ft (pieces), per inch (counters), per ton (slabs)',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  rate: number;

  @ApiPropertyOptional({ description: 'The order line this bill line fills' })
  @IsOptional()
  @IsUUID()
  orderLineId?: string;
}

export class PaymentNowDto {
  @ApiProperty({ enum: ['cash', 'bank'] })
  @IsIn(['cash', 'bank'])
  method: 'cash' | 'bank';

  @ApiProperty({ example: 10000 })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiPropertyOptional({
    description: 'A bank account. Cash goes into the cash in hand.',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

class SaleHeaderDto {
  @ApiProperty({ example: '2026-10-09' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ type: [SaleLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines: SaleLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateBillDto extends SaleHeaderDto {
  @ApiPropertyOptional({ description: 'An existing customer' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'A walk-in has no khata and pays the whole bill now.',
  })
  @IsOptional()
  @IsBoolean()
  walkin?: boolean;

  @ApiPropertyOptional({ description: 'Name of a new customer or a walk-in' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_TYPES })
  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  customerType?: CustomerType;

  @ApiProperty()
  @IsUUID()
  factoryId: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  discount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  transport?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ type: PaymentNowDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentNowDto)
  payment?: PaymentNowDto;

  @ApiPropertyOptional({
    description: 'The customer takes all the stone now: one collection.',
  })
  @IsOptional()
  @IsBoolean()
  takeAll?: boolean;
}

export class UpdateBillDto extends SaleHeaderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  transport?: number;
}

export class ReasonDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class GiveLineDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  lineNo: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(MAX_QTY)
  qty: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_QTY)
  inches?: number;
}

export class GiveStoneDto {
  @ApiProperty({ example: '2026-10-09' })
  @Matches(DATE)
  date: string;

  @ApiPropertyOptional({ example: 'Suzuki KHI-2231' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  vehicle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  receivedBy?: string;

  @ApiProperty({ type: [GiveLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GiveLineDto)
  lines: GiveLineDto[];
}

export class CreateOrderDto extends SaleHeaderDto {
  @ApiProperty()
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: '2026-10-20' })
  @Matches(DATE)
  neededBy: string;

  @ApiProperty()
  @IsUUID()
  factoryId: string;

  @ApiPropertyOptional({ type: PaymentNowDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentNowDto)
  advance?: PaymentNowDto;
}

export class ReceivePaymentDto {
  @ApiProperty({ example: '2026-10-09' })
  @Matches(DATE)
  date: string;

  @ApiProperty()
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: 25000 })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Cash: the cash account (default). Bank: the bank account.',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ example: 'Meezan Bank' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: '0044871' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  chequeNo?: string;

  @ApiPropertyOptional({ example: '2026-11-10' })
  @IsOptional()
  @Matches(DATE)
  chequeDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  billId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ClearChequeDto {
  @ApiProperty({ description: 'The bank account the cheque is deposited in' })
  @IsUUID()
  accountId: string;

  @ApiProperty({ example: '2026-11-12' })
  @Matches(DATE)
  date: string;
}

export class BounceChequeDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason: string;

  @ApiProperty({ example: '2026-11-12' })
  @Matches(DATE)
  date: string;
}
