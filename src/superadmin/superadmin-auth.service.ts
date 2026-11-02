import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import ms from 'ms';
import { Repository } from 'typeorm';
import { LoginThrottleService } from '../auth/login-throttle.service';
import { AllConfigType } from '../config/config.type';
import { SuperAdminEntity } from '../super-admins/infrastructure/persistence/relational/entities/super-admin.entity';
import { getDummyPasswordHash } from '../tenancy/password.util';
import {
  SuperAdminLoginDto,
  SuperAdminLoginResponseDto,
} from './dto/superadmin-login.dto';
import { SuperAdminPayload } from './strategies/jwt-superadmin.strategy';
import { SuperAdminRole } from '../tenancy/tenancy.constants';

@Injectable()
export class SuperAdminAuthService {
  constructor(
    @InjectRepository(SuperAdminEntity)
    private readonly admins: Repository<SuperAdminEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AllConfigType>,
    private readonly loginThrottle: LoginThrottleService,
  ) {}

  async login(
    dto: SuperAdminLoginDto,
    ip: string,
  ): Promise<SuperAdminLoginResponseDto> {
    const throttleKey = `superadmin|${dto.email}`;

    this.loginThrottle.assertAllowed(throttleKey, ip);

    const admin = await this.admins.findOne({ where: { email: dto.email } });

    // Always run bcrypt so the response time does not reveal whether the
    // account exists.
    const passwordOk = await bcrypt.compare(
      dto.password,
      admin?.passwordHash ?? (await getDummyPasswordHash()),
    );

    if (!admin || !passwordOk || admin.status !== 'active') {
      this.loginThrottle.recordFailure(throttleKey, ip);

      throw new UnauthorizedException({
        status: HttpStatus.UNAUTHORIZED,
        message: 'invalidCredentials',
      });
    }

    this.loginThrottle.reset(throttleKey);

    await this.admins.update({ id: admin.id }, { lastLoginAt: new Date() });

    const expiresIn = this.configService.getOrThrow('auth.superAdminExpires', {
      infer: true,
    });
    const payload: SuperAdminPayload = {
      typ: 'superadmin',
      id: admin.id,
      role: admin.role as SuperAdminRole,
    };

    return {
      token: await this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow('auth.superAdminSecret', {
          infer: true,
        }),
        expiresIn,
      }),
      tokenExpires: Date.now() + ms(expiresIn),
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    };
  }
}
