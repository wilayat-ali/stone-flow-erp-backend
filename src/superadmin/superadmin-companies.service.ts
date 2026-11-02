import {
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, In, Repository } from 'typeorm';
import { AllConfigType } from '../config/config.type';
import { CompanyEntity } from '../companies/infrastructure/persistence/relational/entities/company.entity';
import { CompanyInvitationEntity } from '../company-invitations/infrastructure/persistence/relational/entities/company-invitation.entity';
import { CompanyMemberEntity } from '../company-members/infrastructure/persistence/relational/entities/company-member.entity';
import { CompanyPlatformEntity } from '../company-platforms/infrastructure/persistence/relational/entities/company-platform.entity';
import { CompanyRoleEntity } from '../company-roles/infrastructure/persistence/relational/entities/company-role.entity';
import { InviteNotifier } from '../notifications/invite.notifier';
import { RoleEnum } from '../roles/roles.enum';
import { StatusEnum } from '../statuses/statuses.enum';
import { AuditService } from '../tenancy/audit.service';
import { buildInviteLink, buildWhatsAppLink } from '../tenancy/links';
import { generateOneTimeToken } from '../tenancy/one-time-token';
import {
  COMPANY_STATUS,
  INVITATION_STATUS,
  INVITATION_TYPE,
  INVITE_TTL_MS,
  MEMBER_STATUS,
  PLATFORM_KEYS,
  PlatformKey,
  SYSTEM_ROLES,
} from '../tenancy/tenancy.constants';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { normalizePhone } from '../utils/phone';
import { CreateCompanyDto } from './dto/create-company.dto';
import { ListCompaniesQueryDto } from './dto/company-admin-queries.dto';
import { SuperAdminPrincipal } from './strategies/jwt-superadmin.strategy';

type PlatformMap = Record<PlatformKey, boolean>;

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  owner: {
    userId: number | string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
  };
  platforms: PlatformMap;
};

export type InviteLinks = {
  inviteLink: string;
  whatsappLink: string;
  expiresAt: Date;
};

function unprocessable(errors: Record<string, unknown>) {
  return new UnprocessableEntityException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors,
  });
}

@Injectable()
export class SuperAdminCompaniesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CompanyEntity)
    private readonly companies: Repository<CompanyEntity>,
    @InjectRepository(CompanyPlatformEntity)
    private readonly platforms: Repository<CompanyPlatformEntity>,
    private readonly audit: AuditService,
    private readonly notifier: InviteNotifier,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async create(dto: CreateCompanyDto, actor: SuperAdminPrincipal) {
    const ownerPhone = dto.owner.phone ? normalizePhone(dto.owner.phone) : null;

    if (dto.owner.phone && !ownerPhone) {
      throw unprocessable({ owner: { phone: 'invalidPhone' } });
    }

    const ownerEmail = dto.owner.email ?? null;

    if (!ownerPhone && !ownerEmail) {
      throw unprocessable({ owner: 'phoneOrEmailRequired' });
    }

    let inviteToken: string | undefined;
    let inviteExpiresAt: Date | undefined;

    const created = await this.dataSource
      .transaction(async (em) => {
        if (await em.exists(CompanyEntity, { where: { slug: dto.slug } })) {
          throw unprocessable({ slug: 'slugAlreadyTaken' });
        }

        const byPhone = ownerPhone
          ? await em.findOne(UserEntity, { where: { phone: ownerPhone } })
          : null;
        const byEmail = ownerEmail
          ? await em.findOne(UserEntity, { where: { email: ownerEmail } })
          : null;

        if (byPhone && byEmail && byPhone.id !== byEmail.id) {
          throw unprocessable({ owner: 'phoneAndEmailBelongToDifferentUsers' });
        }

        let user = byPhone ?? byEmail;
        const accountExisted = !!user;

        user ??= await em.save(
          em.create(UserEntity, {
            firstName: dto.owner.firstName,
            lastName: dto.owner.lastName ?? null,
            phone: ownerPhone,
            email: ownerEmail,
            provider: 'email',
            role: { id: RoleEnum.user },
            status: { id: StatusEnum.active },
          }),
        );

        const company = await em.save(
          em.create(CompanyEntity, {
            name: dto.name,
            slug: dto.slug,
            status: COMPANY_STATUS.active,
            phone: dto.phone ?? null,
            address: dto.address ?? null,
            ntn: dto.ntn ?? null,
            approvalRequired: dto.approvalRequired ?? true,
            parchiLanguage: dto.parchiLanguage ?? 'en_ur',
            currency: dto.currency ?? 'PKR',
            ownerUser: user,
          }),
        );

        const roles = await em.save(
          SYSTEM_ROLES.map((role) =>
            em.create(CompanyRoleEntity, {
              company,
              key: role.key,
              name: role.name,
              isSystem: true,
            }),
          ),
        );

        await em.save(
          PLATFORM_KEYS.map((platformKey) =>
            em.create(CompanyPlatformEntity, {
              company,
              platformKey,
              isEnabled: dto.platforms.includes(platformKey),
            }),
          ),
        );

        const ownerRole = roles.find((role) => role.key === 'owner')!;

        // An account that already has a password joins straight away. A new
        // account (or one that never set a password) gets a one-time link.
        const needsInvite = !user.password;

        const member = await em.save(
          em.create(CompanyMemberEntity, {
            company,
            user,
            role: ownerRole,
            status: needsInvite ? MEMBER_STATUS.invited : MEMBER_STATUS.active,
            joinedAt: needsInvite ? null : new Date(),
          }),
        );

        if (needsInvite) {
          const { token, tokenHash } = generateOneTimeToken();

          inviteToken = token;
          inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

          await em.save(
            em.create(CompanyInvitationEntity, {
              company,
              type: INVITATION_TYPE.invite,
              phone: ownerPhone,
              email: ownerEmail,
              role: ownerRole,
              user,
              tokenHash,
              expiresAt: inviteExpiresAt,
              status: INVITATION_STATUS.pending,
            }),
          );
        }

        await this.audit.record(
          {
            actorType: 'superadmin',
            actorId: actor.id,
            action: 'company.create',
            companyId: company.id,
            targetType: 'company',
            targetId: company.id,
            metadata: {
              slug: company.slug,
              platforms: dto.platforms,
              ownerUserId: user.id,
              ownerAccountExisted: accountExisted,
            },
          },
          em,
        );

        return { company, member, user, accountExisted };
      })
      .catch((error: { code?: string }) => {
        // Two requests racing for the same slug, phone or email.
        if (error?.code === '23505') {
          throw unprocessable({ slug: 'slugOrOwnerAlreadyExists' });
        }
        throw error;
      });

    let invite: InviteLinks | null = null;

    if (inviteToken && inviteExpiresAt) {
      invite = this.buildInvite(
        created.company.slug,
        inviteToken,
        inviteExpiresAt,
        created.company.name,
        ownerPhone,
      );

      if (ownerEmail) {
        void this.notifier.sendInvitation({
          to: ownerEmail,
          url: invite.inviteLink,
          companyName: created.company.name,
          roleName: 'Owner',
        });
      }
    }

    return {
      company: {
        id: created.company.id,
        name: created.company.name,
        slug: created.company.slug,
        status: created.company.status,
      },
      owner: {
        userId: created.user.id,
        memberId: created.member.id,
        memberStatus: created.member.status,
        accountExisted: created.accountExisted,
      },
      invite,
    };
  }

  async list(query: ListCompaniesQueryDto) {
    const search = query.search?.trim();
    const baseWhere = query.status ? { status: query.status } : {};

    const [rows, total] = await this.companies.findAndCount({
      where: search
        ? [
            { ...baseWhere, name: ILike(`%${search}%`) },
            { ...baseWhere, slug: ILike(`%${search}%`) },
          ]
        : baseWhere,
      relations: { ownerUser: true },
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      data: await this.toSummaries(rows),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async get(id: string): Promise<CompanySummary> {
    const company = await this.companies.findOne({
      where: { id },
      relations: { ownerUser: true },
    });

    if (!company) {
      throw new NotFoundException();
    }

    return (await this.toSummaries([company]))[0];
  }

  async setStatus(
    id: string,
    status: 'active' | 'suspended',
    actor: SuperAdminPrincipal,
  ): Promise<{ id: string; status: string }> {
    const company = await this.companies.findOne({ where: { id } });

    if (!company) {
      throw new NotFoundException();
    }

    if (company.status !== status) {
      await this.dataSource.transaction(async (em) => {
        await em.update(CompanyEntity, { id }, { status });
        await this.audit.record(
          {
            actorType: 'superadmin',
            actorId: actor.id,
            action:
              status === COMPANY_STATUS.suspended
                ? 'company.suspend'
                : 'company.reactivate',
            companyId: id,
            targetType: 'company',
            targetId: id,
          },
          em,
        );
      });
    }

    return { id, status };
  }

  async getPlatforms(companyId: string): Promise<PlatformMap> {
    await this.assertCompanyExists(companyId);

    return this.platformMap(
      await this.platforms.find({ where: { company: { id: companyId } } }),
    );
  }

  async setPlatform(
    companyId: string,
    key: string,
    isEnabled: boolean,
    actor: SuperAdminPrincipal,
  ): Promise<PlatformMap> {
    if (!(PLATFORM_KEYS as readonly string[]).includes(key)) {
      throw new NotFoundException();
    }

    await this.assertCompanyExists(companyId);

    await this.dataSource.transaction(async (em) => {
      const existing = await em.findOne(CompanyPlatformEntity, {
        where: { company: { id: companyId }, platformKey: key },
      });

      if (existing) {
        existing.isEnabled = isEnabled;
        await em.save(existing);
      } else {
        await em.save(
          em.create(CompanyPlatformEntity, {
            company: { id: companyId },
            platformKey: key,
            isEnabled,
          }),
        );
      }

      await this.audit.record(
        {
          actorType: 'superadmin',
          actorId: actor.id,
          action: 'company.platform_set',
          companyId,
          targetType: 'platform',
          targetId: key,
          metadata: { isEnabled },
        },
        em,
      );
    });

    return this.getPlatforms(companyId);
  }

  private buildInvite(
    slug: string,
    token: string,
    expiresAt: Date,
    companyName: string,
    phone: string | null,
  ): InviteLinks {
    const inviteLink = buildInviteLink(
      this.configService.get('app.frontendDomain', { infer: true }),
      slug,
      token,
    );

    return {
      inviteLink,
      whatsappLink: buildWhatsAppLink(
        phone,
        `You are invited to ${companyName} on StoneFlow. Set up your account: ${inviteLink}`,
      ),
      expiresAt,
    };
  }

  private async assertCompanyExists(id: string): Promise<void> {
    if (!(await this.companies.exists({ where: { id } }))) {
      throw new NotFoundException();
    }
  }

  private platformMap(rows: CompanyPlatformEntity[]): PlatformMap {
    const map = Object.fromEntries(
      PLATFORM_KEYS.map((key) => [key, false]),
    ) as PlatformMap;

    for (const row of rows) {
      if ((PLATFORM_KEYS as readonly string[]).includes(row.platformKey)) {
        map[row.platformKey as PlatformKey] = row.isEnabled;
      }
    }

    return map;
  }

  private async toSummaries(rows: CompanyEntity[]): Promise<CompanySummary[]> {
    const platformRows = rows.length
      ? await this.platforms.find({
          where: { company: { id: In(rows.map((row) => row.id)) } },
          relations: { company: true },
        })
      : [];

    return rows.map((company) => ({
      id: company.id,
      name: company.name,
      slug: company.slug,
      status: company.status,
      createdAt: company.createdAt,
      owner: {
        userId: company.ownerUser.id,
        firstName: company.ownerUser.firstName,
        lastName: company.ownerUser.lastName,
        phone: company.ownerUser.phone ?? null,
        email: company.ownerUser.email,
      },
      platforms: this.platformMap(
        platformRows.filter((row) => row.company.id === company.id),
      ),
    }));
  }
}
