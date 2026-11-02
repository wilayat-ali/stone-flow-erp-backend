import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SwitchCompanyDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  companyId: string;
}
