import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import ms from 'ms';
import crypto from 'crypto';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { AuthEmailLoginDto } from './dto/auth-email-login.dto';
import { AuthUpdateDto } from './dto/auth-update.dto';
import { AuthProvidersEnum } from './auth-providers.enum';
import { SocialInterface } from '../social/interfaces/social.interface';
import { AuthRegisterLoginDto } from './dto/auth-register-login.dto';
import { NullableType } from '../utils/types/nullable.type';
import { LoginResponseDto } from './dto/login-response.dto';
import { ConfigService } from '@nestjs/config';
import { JwtRefreshPayloadType } from './strategies/types/jwt-refresh-payload.type';
import { JwtPayloadType } from './strategies/types/jwt-payload.type';
import { UsersService } from '../users/users.service';
import { AllConfigType } from '../config/config.type';
import { MailService } from '../mail/mail.service';
import { RoleEnum } from '../roles/roles.enum';
import { Session } from '../session/domain/session';
import { SessionService } from '../session/session.service';
import { StatusEnum } from '../statuses/statuses.enum';
import { User } from '../users/domain/user';
import { CompanyMember } from '../company-members/domain/company-member';
import { CompaniesService } from '../companies/companies.service';
import { CompanyMembersService } from '../company-members/company-members.service';
import { LoginThrottleService } from './login-throttle.service';
import { AuthWorkspaceLoginDto } from './dto/auth-workspace-login.dto';
import { MyCompanyDto } from './dto/my-company.dto';
import { SwitchCompanyResponseDto } from './dto/switch-company-response.dto';
import { normalizePhone } from '../utils/phone';

type Membership = { companyId: string; memberId: string; roleKey: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly mailService: MailService,
    private readonly companiesService: CompaniesService,
    private readonly companyMembersService: CompanyMembersService,
    private readonly loginThrottle: LoginThrottleService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async validateLogin(loginDto: AuthEmailLoginDto): Promise<LoginResponseDto> {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw this.invalidLoginException({
        email: 'notFound',
      });
    }

    if (user.provider !== AuthProvidersEnum.email) {
      throw this.invalidLoginException({
        email: `needLoginViaProvider:${user.provider}`,
      });
    }

    if (!user.password) {
      throw this.invalidLoginException({
        password: 'incorrectPassword',
      });
    }

    const isValidPassword = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isValidPassword) {
      throw this.invalidLoginException({
        password: 'incorrectPassword',
      });
    }

    const hash = crypto
      .createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    const session = await this.sessionService.create({
      user,
      hash,
    });

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: user.id,
      role: user.role,
      sessionId: session.id,
      hash,
    });

    return {
      refreshToken,
      token,
      tokenExpires,
      user,
    };
  }

  async validateSocialLogin(
    authProvider: string,
    socialData: SocialInterface,
  ): Promise<LoginResponseDto> {
    let user: NullableType<User> = null;
    const socialEmail = socialData.email?.toLowerCase();
    let userByEmail: NullableType<User> = null;

    if (socialEmail && !socialData.emailVerified) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          email: 'emailNotVerified',
        },
      });
    }

    if (socialEmail) {
      userByEmail = await this.usersService.findByEmail(socialEmail);
    }

    if (socialData.id) {
      user = await this.usersService.findBySocialIdAndProvider({
        socialId: socialData.id,
        provider: authProvider,
      });
    }

    if (user) {
      if (socialEmail && !userByEmail) {
        user.email = socialEmail;
      }
      await this.usersService.update(user.id, user);
    } else if (userByEmail) {
      user = userByEmail;

      if (user.status?.id?.toString() === StatusEnum.inactive.toString()) {
        user.provider = authProvider;
        user.socialId = socialData.id;

        await this.usersService.update(user.id, user);
      }
    } else if (socialData.id) {
      const role = {
        id: RoleEnum.user,
      };
      const status = {
        id: StatusEnum.active,
      };

      user = await this.usersService.create({
        email: socialEmail ?? null,
        firstName: socialData.firstName ?? null,
        lastName: socialData.lastName ?? null,
        socialId: socialData.id,
        provider: authProvider,
        role,
        status,
      });

      user = await this.usersService.findById(user.id);
    }

    if (!user) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          user: 'userNotFound',
        },
      });
    }

    const hash = crypto
      .createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    const session = await this.sessionService.create({
      user,
      hash,
    });

    const {
      token: jwtToken,
      refreshToken,
      tokenExpires,
    } = await this.getTokensData({
      id: user.id,
      role: user.role,
      sessionId: session.id,
      hash,
    });

    return {
      refreshToken,
      token: jwtToken,
      tokenExpires,
      user,
    };
  }

  async register(dto: AuthRegisterLoginDto): Promise<void> {
    // Companies and their people are created by a super admin and by
    // invitations; there is no public sign-up unless explicitly enabled.
    if (!this.configService.get('auth.publicRegistration', { infer: true })) {
      throw new NotFoundException();
    }

    const user = await this.usersService.create({
      ...dto,
      email: dto.email,
      role: {
        id: RoleEnum.user,
      },
      status: {
        id: StatusEnum.inactive,
      },
    });

    const hash = await this.jwtService.signAsync(
      {
        confirmEmailUserId: user.id,
      },
      {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
        expiresIn: this.configService.getOrThrow('auth.confirmEmailExpires', {
          infer: true,
        }),
      },
    );

    await this.mailService.userSignUp({
      to: dto.email,
      data: {
        hash,
      },
    });
  }

  async confirmEmail(hash: string): Promise<void> {
    let userId: User['id'];

    try {
      const jwtData = await this.jwtService.verifyAsync<{
        confirmEmailUserId: User['id'];
      }>(hash, {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
        algorithms: ['HS256'],
      });

      userId = jwtData.confirmEmailUserId;
    } catch {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: `invalidHash`,
        },
      });
    }

    const user = await this.usersService.findById(userId);

    if (
      !user ||
      user?.status?.id?.toString() !== StatusEnum.inactive.toString()
    ) {
      throw new NotFoundException({
        status: HttpStatus.NOT_FOUND,
        error: `notFound`,
      });
    }

    user.status = {
      id: StatusEnum.active,
    };

    await this.usersService.update(user.id, user);
  }

  async confirmNewEmail(hash: string): Promise<void> {
    let userId: User['id'];
    let newEmail: User['email'];

    try {
      const jwtData = await this.jwtService.verifyAsync<{
        confirmEmailUserId: User['id'];
        newEmail: User['email'];
      }>(hash, {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
        algorithms: ['HS256'],
      });

      userId = jwtData.confirmEmailUserId;
      newEmail = jwtData.newEmail;
    } catch {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: `invalidHash`,
        },
      });
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new NotFoundException({
        status: HttpStatus.NOT_FOUND,
        error: `notFound`,
      });
    }

    user.email = newEmail;
    user.status = {
      id: StatusEnum.active,
    };

    await this.usersService.update(user.id, user);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      const uniformErrors = this.configService.getOrThrow(
        'auth.uniformErrors',
        { infer: true },
      );

      // With uniform errors enabled we do not reveal whether the email is
      // registered: respond exactly like the success case and skip the mail.
      if (uniformErrors) {
        return;
      }

      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          email: 'emailNotExists',
        },
      });
    }

    const tokenExpiresIn = this.configService.getOrThrow('auth.forgotExpires', {
      infer: true,
    });

    const tokenExpires = Date.now() + ms(tokenExpiresIn);

    const hash = await this.jwtService.signAsync(
      {
        forgotUserId: user.id,
      },
      {
        secret: this.getForgotSecret(user),
        expiresIn: tokenExpiresIn,
      },
    );

    await this.mailService.forgotPassword({
      to: email,
      data: {
        hash,
        tokenExpires,
      },
    });
  }

  async resetPassword(hash: string, password: string): Promise<void> {
    let userId: User['id'] | undefined;

    try {
      const jwtData = this.jwtService.decode<{
        forgotUserId?: User['id'];
      } | null>(hash);

      userId = jwtData?.forgotUserId;
    } catch {
      userId = undefined;
    }

    let user: NullableType<User> = null;

    if (userId !== undefined && userId !== null) {
      try {
        user = await this.usersService.findById(userId);
      } catch {
        user = null;
      }
    }

    if (!user) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: `invalidHash`,
        },
      });
    }

    try {
      await this.jwtService.verifyAsync(hash, {
        secret: this.getForgotSecret(user),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: `invalidHash`,
        },
      });
    }

    user.password = password;

    await this.sessionService.deleteByUserId({
      userId: user.id,
    });

    await this.usersService.update(user.id, user);
  }

  async me(userJwtPayload: JwtPayloadType): Promise<NullableType<User>> {
    return this.usersService.findById(userJwtPayload.id);
  }

  async update(
    userJwtPayload: JwtPayloadType,
    userDto: AuthUpdateDto,
  ): Promise<NullableType<User>> {
    const currentUser = await this.usersService.findById(userJwtPayload.id);

    if (!currentUser) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          user: 'userNotFound',
        },
      });
    }

    if (userDto.password) {
      if (!userDto.oldPassword) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'missingOldPassword',
          },
        });
      }

      if (!currentUser.password) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'incorrectOldPassword',
          },
        });
      }

      const isValidOldPassword = await bcrypt.compare(
        userDto.oldPassword,
        currentUser.password,
      );

      if (!isValidOldPassword) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'incorrectOldPassword',
          },
        });
      } else {
        await this.sessionService.deleteByUserIdWithExclude({
          userId: currentUser.id,
          excludeSessionId: userJwtPayload.sessionId,
        });
      }
    }

    if (userDto.email && userDto.email !== currentUser.email) {
      const userByEmail = await this.usersService.findByEmail(userDto.email);

      if (userByEmail && userByEmail.id !== currentUser.id) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            email: 'emailExists',
          },
        });
      }

      const hash = await this.jwtService.signAsync(
        {
          confirmEmailUserId: currentUser.id,
          newEmail: userDto.email,
        },
        {
          secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
            infer: true,
          }),
          expiresIn: this.configService.getOrThrow('auth.confirmEmailExpires', {
            infer: true,
          }),
        },
      );

      await this.mailService.confirmNewEmail({
        to: userDto.email,
        data: {
          hash,
        },
      });
    }

    delete userDto.email;
    delete userDto.oldPassword;

    await this.usersService.update(userJwtPayload.id, userDto);

    return this.usersService.findById(userJwtPayload.id);
  }

  async refreshToken(
    data: Pick<JwtRefreshPayloadType, 'sessionId' | 'hash'>,
  ): Promise<Omit<LoginResponseDto, 'user'>> {
    const hash = crypto
      .createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    const session = await this.sessionService.updateByHash(
      { id: data.sessionId, hash: data.hash },
      { hash },
    );

    if (!session) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findById(session.user.id);

    if (!user?.role) {
      throw new UnauthorizedException();
    }

    let membership: Membership | undefined = undefined;

    if (session.activeCompany) {
      // The member is read again on refresh, so a removed member or a
      // suspended company cannot keep renewing a company token.
      const member =
        await this.companyMembersService.findActiveByUserAndCompany(
          session.user.id,
          session.activeCompany.id,
        );

      if (!member) {
        throw new UnauthorizedException();
      }

      membership = this.toMembership(member);
    }

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: session.user.id,
      role: {
        id: user.role.id,
      },
      sessionId: session.id,
      hash,
      membership,
    });

    return {
      token,
      refreshToken,
      tokenExpires,
    };
  }

  async softDelete(userJwtPayload: JwtPayloadType): Promise<void> {
    await this.usersService.remove(userJwtPayload.id);
  }

  async logout(data: Pick<JwtPayloadType, 'sessionId'>) {
    return this.sessionService.deleteById(data.sessionId);
  }

  async workspaceLogin(
    dto: AuthWorkspaceLoginDto,
    ip: string,
  ): Promise<LoginResponseDto> {
    const identity = this.parseIdentifier(dto.identifier);
    const throttleKey = `${dto.slug}|${identity?.value ?? dto.identifier.toLowerCase()}`;

    this.loginThrottle.assertAllowed(throttleKey, ip);

    const user = identity
      ? identity.kind === 'email'
        ? await this.usersService.findByEmail(identity.value)
        : await this.usersService.findByPhone(identity.value)
      : null;
    const company = await this.companiesService.findBySlug(dto.slug);

    // Always run bcrypt so the response time does not reveal whether the
    // account exists.
    const passwordOk = await bcrypt.compare(
      dto.password,
      user?.password ?? (await this.getDummyHash()),
    );

    const member =
      user && company && company.status === 'active'
        ? await this.companyMembersService.findActiveByUserAndCompany(
            user.id,
            company.id,
          )
        : null;

    if (
      !user ||
      !company ||
      !member ||
      !passwordOk ||
      user.provider !== AuthProvidersEnum.email ||
      Number(user.status?.id) !== StatusEnum.active
    ) {
      this.loginThrottle.recordFailure(throttleKey, ip);

      // Same answer for an unknown workspace, unknown user, wrong password,
      // non-member, inactive member and suspended company.
      throw new UnauthorizedException({
        status: HttpStatus.UNAUTHORIZED,
        message: 'invalidCredentials',
      });
    }

    this.loginThrottle.reset(throttleKey);

    return this.startCompanySession(user.id, company.id);
  }

  // New session for an active member of an active company. Used after
  // password login and after a new member accepts an invitation.
  async startCompanySession(
    userId: User['id'],
    companyId: string,
  ): Promise<LoginResponseDto> {
    const [user, member] = await Promise.all([
      this.usersService.findById(userId),
      this.companyMembersService.findActiveByUserAndCompany(userId, companyId),
    ]);

    if (!user || !member) {
      throw new UnauthorizedException();
    }

    const hash = crypto
      .createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    const session = await this.sessionService.create({
      user,
      hash,
      activeCompany: member.company,
    });

    await this.usersService.update(user.id, { lastLoginAt: new Date() });

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: user.id,
      role: user.role,
      sessionId: session.id,
      hash,
      membership: this.toMembership(member),
    });

    return {
      refreshToken,
      token,
      tokenExpires,
      user,
    };
  }

  async listCompanies(userJwtPayload: JwtPayloadType): Promise<MyCompanyDto[]> {
    const members = await this.companyMembersService.findActiveByUser(
      userJwtPayload.id,
    );

    return members.map((member) => ({
      companyId: member.company.id,
      name: member.company.name,
      slug: member.company.slug,
      roleKey: member.role.key,
      roleName: member.role.name,
    }));
  }

  async switchCompany(
    userJwtPayload: JwtPayloadType,
    companyId: string,
  ): Promise<SwitchCompanyResponseDto> {
    const member = await this.companyMembersService.findActiveByUserAndCompany(
      userJwtPayload.id,
      companyId,
    );

    if (!member) {
      throw new ForbiddenException();
    }

    await this.sessionService.update(userJwtPayload.sessionId, {
      activeCompany: member.company,
    });

    const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });

    return {
      token: await this.signAccessToken(
        {
          id: userJwtPayload.id,
          role: userJwtPayload.role,
          sessionId: userJwtPayload.sessionId,
          membership: this.toMembership(member),
        },
        tokenExpiresIn,
      ),
      tokenExpires: Date.now() + ms(tokenExpiresIn),
    };
  }

  private parseIdentifier(
    identifier: string,
  ): { kind: 'email' | 'phone'; value: string } | null {
    const trimmed = identifier.trim();

    if (trimmed.includes('@')) {
      return { kind: 'email', value: trimmed.toLowerCase() };
    }

    const phone = normalizePhone(trimmed);

    return phone ? { kind: 'phone', value: phone } : null;
  }

  private dummyHash: Promise<string> | undefined;

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= bcrypt.hash(randomStringGenerator(), 10);
    return this.dummyHash;
  }

  private toMembership(member: CompanyMember): Membership {
    return {
      companyId: member.company.id,
      memberId: member.id,
      roleKey: member.role.key,
    };
  }

  private signAccessToken(
    data: {
      id: User['id'];
      role: User['role'];
      sessionId: Session['id'];
      membership?: Membership;
    },
    expiresIn: NonNullable<JwtSignOptions['expiresIn']>,
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        typ: 'user',
        id: data.id,
        role: data.role,
        sessionId: data.sessionId,
        ...data.membership,
      },
      {
        secret: this.configService.getOrThrow('auth.secret', { infer: true }),
        expiresIn,
      },
    );
  }

  private invalidLoginException(
    errors: Record<string, string>,
  ): UnprocessableEntityException {
    const uniformErrors = this.configService.getOrThrow('auth.uniformErrors', {
      infer: true,
    });

    return new UnprocessableEntityException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      errors: uniformErrors
        ? {
            email: 'incorrectEmailOrPassword',
            password: 'incorrectEmailOrPassword',
          }
        : errors,
    });
  }

  private getForgotSecret(user: User): string {
    // The secret embeds the current password hash, so every outstanding
    // reset link stops verifying as soon as the password changes — this is
    // what makes reset links single-use without storing anything extra.
    const forgotSecret = this.configService.getOrThrow('auth.forgotSecret', {
      infer: true,
    });

    return `${forgotSecret}${user.password ?? ''}`;
  }

  private async getTokensData(data: {
    id: User['id'];
    role: User['role'];
    sessionId: Session['id'];
    hash: Session['hash'];
    membership?: Membership;
  }) {
    const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });

    const tokenExpires = Date.now() + ms(tokenExpiresIn);

    const [token, refreshToken] = await Promise.all([
      this.signAccessToken(data, tokenExpiresIn),
      await this.jwtService.signAsync(
        {
          sessionId: data.sessionId,
          hash: data.hash,
        },
        {
          secret: this.configService.getOrThrow('auth.refreshSecret', {
            infer: true,
          }),
          expiresIn: this.configService.getOrThrow('auth.refreshExpires', {
            infer: true,
          }),
        },
      ),
    ]);

    return {
      token,
      refreshToken,
      tokenExpires,
    };
  }
}
