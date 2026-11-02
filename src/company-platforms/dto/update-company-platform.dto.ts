// Don't forget to use the class-validator decorators in the DTO properties.
// import { Allow } from 'class-validator';

import { PartialType } from '@nestjs/swagger';
import { CreateCompanyPlatformDto } from './create-company-platform.dto';

export class UpdateCompanyPlatformDto extends PartialType(
  CreateCompanyPlatformDto,
) {}
