import { ApiProperty } from '@nestjs/swagger';

export class WorkspaceVerifyResponseDto {
  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String, example: 'active' })
  status: string;

  @ApiProperty({ type: String, example: 'tangerine' })
  theme: string;
}
