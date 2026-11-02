import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Request,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { LoginResponseDto } from '../auth/dto/login-response.dto';
import { SwitchCompanyResponseDto } from '../auth/dto/switch-company-response.dto';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import {
  AcceptExistingInvitationDto,
  AcceptInvitationDto,
  InvitationTokenQueryDto,
  ResetPasswordWithLinkDto,
} from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

// Public side of invitation and password links. The links themselves are
// created by company owners/partners or by super admin.
@ApiTags('Invitations')
@Controller({
  path: 'auth/invitations',
  version: '1',
})
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Get('info')
  @ApiOkResponse({
    description: 'What the link is for; 404 if invalid, used or expired',
  })
  info(@Query() query: InvitationTokenQueryDto) {
    return this.service.getInfo(query.token);
  }

  // New person: choose a name and password, join, and get logged in.
  @SerializeOptions({ groups: ['me'] })
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  accept(@Body() dto: AcceptInvitationDto): Promise<LoginResponseDto> {
    return this.service.acceptNew(dto);
  }

  // Existing account: log in with your own password first, then accept.
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @Post('accept-existing')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SwitchCompanyResponseDto })
  acceptExisting(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() dto: AcceptExistingInvitationDto,
  ): Promise<SwitchCompanyResponseDto> {
    return this.service.acceptExisting(request.user, dto.token);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordWithLinkDto): Promise<void> {
    return this.service.consumeReset(dto.token, dto.password);
  }
}
