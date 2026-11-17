import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

const MAX_AMOUNT = 100_000_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateWorkerPaymentDto {
  @ApiProperty()
  @IsUUID()
  workerId: string;

  @ApiProperty({ example: 2000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiProperty({ example: '2026-11-09' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ description: 'The cash or bank account the money leaves' })
  @IsUUID()
  accountId: string;

  @ApiPropertyOptional({ example: 'Advance' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class AttendanceDto {
  @ApiProperty({ example: '2026-11-10' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ type: [String], description: 'Workers absent that day' })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  absentIds: string[];
}

export class RegisterRowDto {
  @ApiProperty()
  @IsUUID()
  workerId: string;

  @ApiProperty({ example: 1200 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  feet: number;
}

export class RegisterDto {
  @ApiProperty({ example: '2026-11-10' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ type: [RegisterRowDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => RegisterRowDto)
  rows: RegisterRowDto[];
}

export class RejectWorkerPaymentDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
