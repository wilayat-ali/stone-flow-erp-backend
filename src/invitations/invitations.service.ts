import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { LoginResponseDto } from '../auth/dto/login-response.dto';
import { SwitchCompanyResponseDto } from '../auth/dto/switch-company-response.dto';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import {
  assignableRoles,
  canManageTarget,
} from '../company-admin/member-policy';
import { AllConfigType } from '../config/config.type';
import { CompanyInvitationEntity } from '../company-invitations/infrastructure/persistence/relational/entities/company-invitation.entity';
import { CompanyMemberEntity } from '../company-members/infrastructure/persistence/relational/entities/company-member.entity';
import { CompanyRoleEntity } from '../company-roles/infrastructure/persistence/relational/entities/company-role.entity';
import { InviteNotifier } from '../notifications/invite.notifier';
import { RoleEnum } from '../roles/roles.enum';
import { SessionEntity } from '../session/infrastructure/persistence/relational/entities/session.entity';
import { StatusEnum } from '../statuses/statuses.enum';
import { AuditService } from '../tenancy/audit.service';
import {
  buildInviteLink,
  buildResetLink,
  buildWhatsAppLink,
} from '../tenancy/links';
import {
  generateOneTimeToken,
  hashOneTimeToken,
} from '../tenancy/one-time-token';
import { hashPassword } from '../tenancy/password.util';
import {
  COMPANY_ROLE_KEYS,
  CompanyRoleKey,
  COMPANY_STATUS,
  INVITATION_STATUS,
  INVITATION_TYPE,
  INVITE_TTL_MS,
  MEMBER_STATUS,
  RESET_TTL_MS,
  SuperAdminRole,
} from '../tenancy/tenancy.constants';
import { inCompany } from '../tenancy/tenant-scope';
import { TenantContext } from '../tenancy/tenant-context';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { normalizePhone } from '../utils/phone';
import { AcceptInvitationDto } from './dto/invitation.dto';

export type ResetActor =
  | { type: 'member'; tenant: TenantContext }
  | { type: 'superadmin'; id: string; role: SuperAdminRole };

export type InvitationResult = {
  invitationId: string;
  inviteLink: string;
  whatsappLink: string;
  expiresAt: Date;
  emailQueued: boolean;
};

function unprocessable(errors: Record<string, unknown>) {
  return new UnprocessableEntityException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors,
  });
}

const INVALID_LINK = 'invalidOrExpiredLink';

@Injectable()
export class InvitationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CompanyInvitationEntity)
    private readonly invitations: Repository<CompanyInvitationEntity>,
    @InjectRepository(CompanyMemberEntity)
    private readonly members: Repository<CompanyMemberEntity>,
    @InjectRepository(CompanyRoleEntity)
    private readonly roles: Repository<CompanyRoleEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly audit: AuditService,
    private readonly notifier: InviteNotifier,
    private readonly authService: AuthService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  // ---------------------------------------------------------------- invite

  async createInvitation(
    tenant: TenantContext,
    dto: { phone?: string; email?: string; roleKey: string },
  ): Promise<InvitationResult> {
    if (dto.roleKey === 'owner') {
      throw unprocessable({ roleKey: 'cannotInviteAsOwner' });
    }

    if (
      !(COMPANY_ROLE_KEYS as readonly string[]).includes(dto.roleKey) ||
      !assignableRoles(tenant.roleKey).includes(dto.roleKey as CompanyRoleKey)
    ) {
      throw new ForbiddenException();
    }

    const phone = dto.phone ? normalizePhone(dto.phone) : null;

    if (dto.phone && !phone) {
      throw unprocessable({ phone: 'invalidPhone' });
    }

    const email = dto.email?.trim().toLowerCase() || null;

    if (!phone && !email) {
      throw unprocessable({ identifier: 'phoneOrEmailRequired' });
    }

    const role = await this.roles.findOne({
      where: { ...inCompany(tenant.companyId), key: dto.roleKey },
    });

    if (!role) {
      throw unprocessable({ roleKey: 'notExists' });
    }

    const [byPhone, byEmail] = await Promise.all([
      phone ? this.users.findOne({ where: { phone } }) : null,
      email ? this.users.findOne({ where: { email } }) : null,
    ]);

    if (byPhone && byEmail && byPhone.id !== byEmail.id) {
      throw unprocessable({
        identifier: 'phoneAndEmailBelongToDifferentUsers',
      });
    }

    const existingUser = byPhone ?? byEmail;

    if (existingUser) {
      const existingMember = await this.members.findOne({
        where: {
          ...inCompany(tenant.companyId),
          user: { id: existingUser.id },
        },
      });

      if (existingMember && existingMember.status !== MEMBER_STATUS.inactive) {
        throw unprocessable({ identifier: 'alreadyMember' });
      }
    }

    const { token, tokenHash } = generateOneTimeToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invitation = await this.dataSource.transaction(async (em) => {
      // A new invite replaces any pending one for the same person.
      const pending = em
        .createQueryBuilder()
        .update(CompanyInvitationEntity)
        .set({ status: INVITATION_STATUS.revoked })
        .where(
          '"companyId" = :companyId AND type = :type AND status = :pending',
          {
            companyId: tenant.companyId,
            type: INVITATION_TYPE.invite,
            pending: INVITATION_STATUS.pending,
          },
        );

      if (phone && email) {
        pending.andWhere('(phone = :phone OR email = :email)', {
          phone,
          email,
        });
      } else if (phone) {
        pending.andWhere('phone = :phone', { phone });
      } else {
        pending.andWhere('email = :email', { email });
      }

      await pending.execute();

      const saved = await em.save(
        em.create(CompanyInvitationEntity, {
          company: { id: tenant.companyId },
          type: INVITATION_TYPE.invite,
          phone,
          email,
          role,
          user: existingUser ?? null,
          tokenHash,
          expiresAt,
          status: INVITATION_STATUS.pending,
          invitedByMember: { id: tenant.memberId },
        }),
      );

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'member.invite',
          companyId: tenant.companyId,
          targetType: 'invitation',
          targetId: saved.id,
          metadata: { roleKey: role.key, byPhone: !!phone, byEmail: !!email },
        },
        em,
      );

      return saved;
    });

    const inviteLink = buildInviteLink(
      this.frontendDomain(),
      tenant.companySlug,
      token,
    );

    if (email) {
      void this.notifier.sendInvitation({
        to: email,
        url: inviteLink,
        companyName: tenant.companyName,
        roleName: role.name,
      });
    }

    // The response is the same whether or not the person already has an
    // account somewhere, so an owner cannot probe for accounts.
    return {
      invitationId: invitation.id,
      inviteLink,
      whatsappLink: buildWhatsAppLink(
        phone,
        `You are invited to ${tenant.companyName} on StoneFlow as ${role.name}. Open this link to join: ${inviteLink}`,
      ),
      expiresAt,
      emailQueued: !!email && this.notifier.isEnabled(),
    };
  }

  async listPending(companyId: string) {
    const rows = await this.invitations.find({
      where: {
        ...inCompany(companyId),
        type: INVITATION_TYPE.invite,
        status: INVITATION_STATUS.pending,
      },
      relations: { role: true },
      order: { createdAt: 'DESC' },
    });

    return rows.map((invitation) => ({
      id: invitation.id,
      phone: invitation.phone ?? null,
      email: invitation.email ?? null,
      roleKey: invitation.role?.key ?? null,
      roleName: invitation.role?.name ?? null,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    }));
  }

  async revoke(tenant: TenantContext, invitationId: string) {
    const invitation = await this.invitations.findOne({
      where: {
        id: invitationId,
        ...inCompany(tenant.companyId),
        type: INVITATION_TYPE.invite,
        status: INVITATION_STATUS.pending,
      },
    });

    if (!invitation) {
      throw new NotFoundException();
    }

    await this.dataSource.transaction(async (em) => {
      await em
        .createQueryBuilder()
        .update(CompanyInvitationEntity)
        .set({ status: INVITATION_STATUS.revoked })
        .where('id = :id AND "companyId" = :companyId', {
          id: invitation.id,
          companyId: tenant.companyId,
        })
        .execute();
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'member.invite_revoke',
          companyId: tenant.companyId,
          targetType: 'invitation',
          targetId: invitation.id,
        },
        em,
      );
    });

    return { id: invitation.id, status: INVITATION_STATUS.revoked };
  }

  // ----------------------------------------------------------- reset link

  async createResetLink(
    target: { companyId: string; memberId: string },
    actor: ResetActor,
  ) {
    const member = await this.members.findOne({
      where: { id: target.memberId, ...inCompany(target.companyId) },
      relations: { user: true, role: true, company: true },
    });

    if (!member) {
      throw new NotFoundException();
    }

    if (member.status !== MEMBER_STATUS.active) {
      // Someone who never joined has no password to reset; send an invite.
      throw unprocessable({ member: 'memberNotActive' });
    }

    if (actor.type === 'member') {
      if (member.id === actor.tenant.memberId) {
        throw unprocessable({ member: 'cannotChangeSelf' });
      }

      if (
        !canManageTarget(
          actor.tenant.roleKey,
          member.role.key as CompanyRoleKey,
        )
      ) {
        throw new ForbiddenException(
          member.role.key === 'owner' ? 'ownerProtected' : undefined,
        );
      }

      // One password covers every company the person works in, so a company
      // may only reset people who belong to no other active company.
      // Those people use their own email reset or ask support.
      const otherMemberships = await this.members
        .createQueryBuilder('member')
        .innerJoin('member.company', 'company')
        .where('member."userId" = :userId', { userId: member.user.id })
        .andWhere('member.id != :memberId', { memberId: member.id })
        .andWhere('member.status = :active', { active: MEMBER_STATUS.active })
        .andWhere('company.status = :companyActive', {
          companyActive: COMPANY_STATUS.active,
        })
        .getCount();

      if (otherMemberships > 0) {
        throw new ConflictException({
          status: HttpStatus.CONFLICT,
          message: 'memberInOtherCompany',
        });
      }
    }

    const { token, tokenHash } = generateOneTimeToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await this.dataSource.transaction(async (em) => {
      await em
        .createQueryBuilder()
        .update(CompanyInvitationEntity)
        .set({ status: INVITATION_STATUS.revoked })
        .where(
          '"companyId" = :companyId AND "userId" = :userId AND type = :type AND status = :pending',
          {
            companyId: target.companyId,
            userId: member.user.id,
            type: INVITATION_TYPE.reset,
            pending: INVITATION_STATUS.pending,
          },
        )
        .execute();

      await em.save(
        em.create(CompanyInvitationEntity, {
          company: { id: target.companyId },
          type: INVITATION_TYPE.reset,
          phone: member.user.phone ?? null,
          email: member.user.email ?? null,
          role: null,
          user: member.user,
          tokenHash,
          expiresAt,
          status: INVITATION_STATUS.pending,
          invitedByMember:
            actor.type === 'member' ? { id: actor.tenant.memberId } : null,
        }),
      );

      await this.audit.record(
        {
          actorType: actor.type === 'member' ? 'member' : 'superadmin',
          actorId: actor.type === 'member' ? actor.tenant.memberId : actor.id,
          action: 'member.reset_link',
          companyId: target.companyId,
          targetType: 'member',
          targetId: member.id,
        },
        em,
      );
    });

    const resetLink = buildResetLink(
      this.frontendDomain(),
      member.company.slug,
      token,
    );

    if (member.user.email) {
      void this.notifier.sendPasswordLink({
        to: member.user.email,
        url: resetLink,
        companyName: member.company.name,
      });
    }

    return {
      resetLink,
      whatsappLink: buildWhatsAppLink(
        member.user.phone,
        `Open this link to set a new password for ${member.company.name} on StoneFlow: ${resetLink}`,
      ),
      expiresAt,
    };
  }

  // ---------------------------------------------------------- public side

  async getInfo(token: string) {
    const invitation = await this.findUsable(token);

    return {
      type: invitation.type,
      companyName: invitation.company.name,
      companySlug: invitation.company.slug,
      roleName: invitation.role?.name ?? null,
    };
  }

  // New person: sets a name and password and joins. If the phone or email
  // already belongs to an account with a password, that person must log in
  // and accept with their own password instead; nothing here ever changes an
  // existing password.
  async acceptNew(dto: AcceptInvitationDto): Promise<LoginResponseDto> {
    const invitation = await this.findUsable(dto.token, INVITATION_TYPE.invite);

    const existing =
      invitation.user ??
      (invitation.phone
        ? await this.users.findOne({ where: { phone: invitation.phone } })
        : null) ??
      (invitation.email
        ? await this.users.findOne({ where: { email: invitation.email } })
        : null);

    if (existing?.password) {
      throw new ConflictException({
        status: HttpStatus.CONFLICT,
        message: 'accountExists',
      });
    }

    const passwordHash = await hashPassword(dto.password);

    const userId = await this.dataSource
      .transaction(async (em) => {
        const user = existing
          ? await em.save(
              Object.assign(existing, {
                firstName: dto.firstName,
                lastName: dto.lastName ?? existing.lastName,
                password: passwordHash,
              }),
            )
          : await em.save(
              em.create(UserEntity, {
                firstName: dto.firstName,
                lastName: dto.lastName ?? null,
                phone: invitation.phone,
                email: invitation.email,
                password: passwordHash,
                provider: 'email',
                role: { id: RoleEnum.user },
                status: { id: StatusEnum.active },
              }),
            );

        this.assertUserActive(user);

        await this.joinCompany(em, invitation, user);
        await this.markAccepted(em, invitation);
        await this.audit.record(
          {
            actorType: 'system',
            actorId: String(user.id),
            action: 'invitation.accept',
            companyId: invitation.company.id,
            targetType: 'invitation',
            targetId: invitation.id,
            metadata: { newAccount: !existing },
          },
          em,
        );

        return user.id;
      })
      .catch((error: { code?: string }) => {
        if (error?.code === '23505') {
          throw new ConflictException({
            status: HttpStatus.CONFLICT,
            message: 'accountExists',
          });
        }
        throw error;
      });

    return this.authService.startCompanySession(
      Number(userId),
      invitation.company.id,
    );
  }

  // Existing account: must be logged in, and the invitation must be for
  // that person (same phone or email, or the user it was created for).
  async acceptExisting(
    payload: JwtPayloadType,
    token: string,
  ): Promise<SwitchCompanyResponseDto> {
    const invitation = await this.findUsable(token, INVITATION_TYPE.invite);
    const user = await this.users.findOne({
      where: { id: Number(payload.id) },
    });

    if (!user) {
      throw new NotFoundException(INVALID_LINK);
    }

    this.assertUserActive(user);

    const isForThisUser =
      invitation.user?.id === user.id ||
      (!!invitation.phone && user.phone === invitation.phone) ||
      (!!invitation.email && user.email?.toLowerCase() === invitation.email);

    if (!isForThisUser) {
      throw new ForbiddenException('invitationNotForYou');
    }

    await this.dataSource.transaction(async (em) => {
      await this.joinCompany(em, invitation, user);
      await this.markAccepted(em, invitation);
      await this.audit.record(
        {
          actorType: 'system',
          actorId: String(user.id),
          action: 'invitation.accept',
          companyId: invitation.company.id,
          targetType: 'invitation',
          targetId: invitation.id,
          metadata: { newAccount: false },
        },
        em,
      );
    });

    return this.authService.switchCompany(payload, invitation.company.id);
  }

  async consumeReset(token: string, password: string): Promise<void> {
    const invitation = await this.findUsable(token, INVITATION_TYPE.reset);

    if (!invitation.user) {
      throw new NotFoundException(INVALID_LINK);
    }

    this.assertUserActive(invitation.user);

    const passwordHash = await hashPassword(password);
    const userId = invitation.user.id;

    await this.dataSource.transaction(async (em) => {
      await em
        .createQueryBuilder()
        .update(UserEntity)
        .set({ password: passwordHash })
        .where('id = :id', { id: userId })
        .execute();

      // Every device is logged out after a password reset.
      await em
        .createQueryBuilder()
        .delete()
        .from(SessionEntity)
        .where('"userId" = :userId', { userId })
        .execute();

      await this.markAccepted(em, invitation);
      await this.audit.record(
        {
          actorType: 'system',
          actorId: String(userId),
          action: 'member.password_reset_done',
          companyId: invitation.company.id,
          targetType: 'user',
          targetId: String(userId),
        },
        em,
      );
    });
  }

  // --------------------------------------------------------------- helpers

  private frontendDomain(): string | undefined {
    return this.configService.get('app.frontendDomain', { infer: true });
  }

  private assertUserActive(user: UserEntity): void {
    if (Number(user.status?.id) !== StatusEnum.active) {
      throw new NotFoundException(INVALID_LINK);
    }
  }

  private async findUsable(
    token: string,
    type?: string,
  ): Promise<CompanyInvitationEntity> {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: hashOneTimeToken(token), ...(type ? { type } : {}) },
      relations: { company: true, role: true, user: true },
    });

    if (
      !invitation ||
      invitation.status !== INVITATION_STATUS.pending ||
      invitation.company.status !== COMPANY_STATUS.active
    ) {
      throw new NotFoundException(INVALID_LINK);
    }

    if (invitation.expiresAt.getTime() < Date.now()) {
      await this.invitations.update(
        { id: invitation.id },
        { status: INVITATION_STATUS.expired },
      );
      throw new NotFoundException(INVALID_LINK);
    }

    return invitation;
  }

  private async joinCompany(
    em: EntityManager,
    invitation: CompanyInvitationEntity,
    user: UserEntity,
  ): Promise<void> {
    const existing = await em.findOne(CompanyMemberEntity, {
      where: {
        company: { id: invitation.company.id },
        user: { id: user.id },
      },
      relations: { role: true },
    });

    if (existing) {
      existing.status = MEMBER_STATUS.active;
      existing.joinedAt ??= new Date();

      // An owner keeps the owner role whatever the invitation says.
      if (existing.role.key !== 'owner' && invitation.role) {
        existing.role = invitation.role;
      }

      await em.save(existing);
      return;
    }

    await em.save(
      em.create(CompanyMemberEntity, {
        company: { id: invitation.company.id },
        user: { id: user.id },
        role: invitation.role!,
        status: MEMBER_STATUS.active,
        joinedAt: new Date(),
        invitedByMember: invitation.invitedByMember ?? null,
      }),
    );
  }

  private async markAccepted(
    em: EntityManager,
    invitation: CompanyInvitationEntity,
  ): Promise<void> {
    await em
      .createQueryBuilder()
      .update(CompanyInvitationEntity)
      .set({ status: INVITATION_STATUS.accepted, acceptedAt: new Date() })
      .where('id = :id', { id: invitation.id })
      .execute();
  }
}
