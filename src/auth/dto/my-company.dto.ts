import { ApiProperty } from '@nestjs/swagger';

export class MyCompanyDto {
  @ApiProperty({ type: String })
  companyId: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  slug: string;

  @ApiProperty({ type: String })
  roleKey: string;

  @ApiProperty({ type: String })
  roleName: string;
}
