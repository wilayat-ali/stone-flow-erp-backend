// Don't forget to use the class-validator decorators in the DTO properties.
// import { Allow } from 'class-validator';

import { PartialType } from '@nestjs/swagger';
import { CreateSuperAdminDto } from './create-super-admin.dto';

export class UpdateSuperAdminDto extends PartialType(CreateSuperAdminDto) {}
