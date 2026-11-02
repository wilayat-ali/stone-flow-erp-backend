import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  SuperAdminLoginDto,
  SuperAdminLoginResponseDto,
} from './dto/superadmin-login.dto';
import { SuperAdminAuthService } from './superadmin-auth.service';

@ApiTags('Super Admin')
@Controller({
  path: 'superadmin/auth',
  version: '1',
})
export class SuperAdminAuthController {
  constructor(private readonly service: SuperAdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SuperAdminLoginResponseDto })
  login(
    @Body() dto: SuperAdminLoginDto,
    @Ip() ip: string,
  ): Promise<SuperAdminLoginResponseDto> {
    return this.service.login(dto, ip);
  }
}
