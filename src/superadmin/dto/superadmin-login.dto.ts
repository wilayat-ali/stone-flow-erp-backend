import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SuperAdminLoginDto {
  @ApiProperty({ example: 'superadmin@example.com', type: String })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'secret', type: String })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class SuperAdminLoginResponseDto {
  @ApiProperty()
  token: string;

  @ApiProperty()
  tokenExpires: number;

  @ApiProperty({
    example: {
      id: 'uuid',
      name: 'Super Admin',
      email: 'a@b.c',
      role: 'super_admin',
    },
  })
  admin: { id: string; name: string; email: string; role: string };
}
