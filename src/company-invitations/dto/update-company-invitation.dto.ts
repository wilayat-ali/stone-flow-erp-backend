// Don't forget to use the class-validator decorators in the DTO properties.
// import { Allow } from 'class-validator';

import { PartialType } from '@nestjs/swagger';
import { CreateCompanyInvitationDto } from './create-company-invitation.dto';

export class UpdateCompanyInvitationDto extends PartialType(
  CreateCompanyInvitationDto,
) {}
