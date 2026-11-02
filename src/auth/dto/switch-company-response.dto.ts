import { ApiProperty } from '@nestjs/swagger';

export class SwitchCompanyResponseDto {
  @ApiProperty()
  token: string;

  @ApiProperty()
  tokenExpires: number;
}
