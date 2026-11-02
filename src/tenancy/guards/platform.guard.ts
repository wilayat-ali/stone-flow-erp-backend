import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyPlatformEntity } from '../../company-platforms/infrastructure/persistence/relational/entities/company-platform.entity';
import { PlatformKey } from '../tenancy.constants';
import { RequestWithTenant } from '../tenant-context';
import { PLATFORM_KEY } from '../decorators/platform.decorator';

// A platform is a business area (factory, showroom, mine) the super admin
// switched on for the company. No row means it is off.
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(CompanyPlatformEntity)
    private readonly platforms: Repository<CompanyPlatformEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const platform = this.reflector.getAllAndOverride<PlatformKey | undefined>(
      PLATFORM_KEY,
      [context.getClass(), context.getHandler()],
    );

    if (!platform) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();

    const enabled =
      request.tenant &&
      (await this.platforms.exists({
        where: {
          company: { id: request.tenant.companyId },
          platformKey: platform,
          isEnabled: true,
        },
      }));

    if (!enabled) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'This platform is not enabled for this workspace.',
        reason: 'PLATFORM_NOT_ENABLED',
        platform,
      });
    }

    return true;
  }
}
