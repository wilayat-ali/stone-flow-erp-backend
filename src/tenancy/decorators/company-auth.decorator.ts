import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CompanyGuard } from '../guards/company.guard';
import { CompanyRolesGuard } from '../guards/company-roles.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PlatformGuard } from '../guards/platform.guard';

// Company-scoped route: valid user token, active member of an active company,
// then (when present) @CompanyRoles(), @Permissions() and @Platform() checks,
// in that order.
export const CompanyAuth = () =>
  applyDecorators(
    ApiBearerAuth(),
    UseGuards(
      AuthGuard('jwt'),
      CompanyGuard,
      CompanyRolesGuard,
      PermissionsGuard,
      PlatformGuard,
    ),
    ApiUnauthorizedResponse({
      description: 'Not logged in or membership no longer active',
    }),
    ApiForbiddenResponse({
      description: 'Role, permission or platform not allowed',
    }),
  );
