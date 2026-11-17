import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { APPROVAL_STATUS } from '../../approvals/approval.types';
import { INBOX_TYPES } from '../approval-inbox.service';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListInboxQueryDto {
  @ApiPropertyOptional({ enum: Object.values(APPROVAL_STATUS) })
  @IsOptional()
  @IsIn(Object.values(APPROVAL_STATUS))
  status?: 'pending' | 'approved' | 'rejected';

  @ApiPropertyOptional({ enum: INBOX_TYPES })
  @IsOptional()
  @IsIn(INBOX_TYPES)
  type?: (typeof INBOX_TYPES)[number];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class RejectInboxDto {
  @ApiProperty({ example: 'Not needed this month' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
