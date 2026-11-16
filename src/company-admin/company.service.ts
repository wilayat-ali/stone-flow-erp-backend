import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyEntity } from '../companies/infrastructure/persistence/relational/entities/company.entity';
import { CompanyPlatformEntity } from '../company-platforms/infrastructure/persistence/relational/entities/company-platform.entity';
import { AuditService } from '../tenancy/audit.service';
import {
  DEFAULT_THEME,
  PLATFORM_KEYS,
  PlatformKey,
} from '../tenancy/tenancy.constants';
import { inCompany } from '../tenancy/tenant-scope';
import { TenantContext } from '../tenancy/tenant-context';

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(CompanyEntity)
    private readonly companies: Repository<CompanyEntity>,
    @InjectRepository(CompanyPlatformEntity)
    private readonly platforms: Repository<CompanyPlatformEntity>,
    private readonly audit: AuditService,
  ) {}

  async me(tenant: TenantContext) {
    const [company, platformRows] = await Promise.all([
      this.companies.findOneByOrFail({ id: tenant.companyId }),
      this.platforms.find({ where: inCompany(tenant.companyId) }),
    ]);

    const platforms = Object.fromEntries(
      PLATFORM_KEYS.map((key) => [key, false]),
    ) as Record<PlatformKey, boolean>;

    for (const row of platformRows) {
      if ((PLATFORM_KEYS as readonly string[]).includes(row.platformKey)) {
        platforms[row.platformKey as PlatformKey] = row.isEnabled;
      }
    }

    return {
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        phone: company.phone ?? null,
        address: company.address ?? null,
        ntn: company.ntn ?? null,
        currency: company.currency,
        parchiLanguage: company.parchiLanguage,
        approvalRequired: company.approvalRequired,
        theme: company.theme ?? DEFAULT_THEME,
      },
      me: {
        memberId: tenant.memberId,
        roleKey: tenant.roleKey,
        roleName: tenant.roleName,
        permissions: tenant.permissions,
      },
      platforms,
    };
  }

  // Company-wide switches. Anyone in the company may read them (the entry
  // forms need to know whether a Munshi's entry waits for approval).
  async settings(tenant: TenantContext) {
    const company = await this.companies.findOneByOrFail({
      id: tenant.companyId,
    });

    return { approvalRequired: company.approvalRequired };
  }

  async setApprovalRequired(tenant: TenantContext, approvalRequired: boolean) {
    await this.companies.update({ id: tenant.companyId }, { approvalRequired });

    await this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action: 'company.approval_required_set',
      companyId: tenant.companyId,
      targetType: 'company',
      targetId: tenant.companyId,
      metadata: { approvalRequired },
    });

    return { approvalRequired };
  }

  // The company's default colour theme. Each person can still pick their own.
  async setTheme(tenant: TenantContext, theme: string) {
    await this.companies.update({ id: tenant.companyId }, { theme });

    await this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action: 'company.theme_set',
      companyId: tenant.companyId,
      targetType: 'company',
      targetId: tenant.companyId,
      metadata: { theme },
    });

    return { theme };
  }
}
