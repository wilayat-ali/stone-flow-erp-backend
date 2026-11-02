import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AllConfigType } from '../../config/config.type';
import { SuperAdminEntity } from '../../super-admins/infrastructure/persistence/relational/entities/super-admin.entity';
import { SuperAdminRole } from '../../tenancy/tenancy.constants';

export type SuperAdminPayload = {
  typ: 'superadmin';
  id: string;
  role: SuperAdminRole;
};

export type SuperAdminPrincipal = {
  id: string;
  name: string;
  role: SuperAdminRole;
};

// Signed with its own secret and a different `typ`, so a company user token
// can never pass here and a super admin token can never pass the user strategy.
@Injectable()
export class JwtSuperAdminStrategy extends PassportStrategy(
  Strategy,
  'jwt-superadmin',
) {
  constructor(
    configService: ConfigService<AllConfigType>,
    @InjectRepository(SuperAdminEntity)
    private readonly admins: Repository<SuperAdminEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow('auth.superAdminSecret', {
        infer: true,
      }),
      algorithms: ['HS256'],
    });
  }

  // Checked against the database on every request, so a disabled admin or a
  // changed role applies immediately.
  async validate(payload: SuperAdminPayload): Promise<SuperAdminPrincipal> {
    if (payload.typ !== 'superadmin' || !payload.id) {
      throw new UnauthorizedException();
    }

    const admin = await this.admins.findOne({
      where: { id: payload.id, status: 'active' },
    });

    if (!admin) {
      throw new UnauthorizedException();
    }

    return {
      id: admin.id,
      name: admin.name,
      role: admin.role as SuperAdminRole,
    };
  }
}
