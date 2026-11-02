import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyEntity } from '../companies/infrastructure/persistence/relational/entities/company.entity';
import { CompanyPlatformEntity } from '../company-platforms/infrastructure/persistence/relational/entities/company-platform.entity';
import { PLATFORM_KEYS, PlatformKey } from '../tenancy/tenancy.constants';
import { inCompany } from '../tenancy/tenant-scope';
import { TenantContext } from '../tenancy/tenant-context';

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(CompanyEntity)
    private readonly companies: Repository<CompanyEntity>,
    @InjectRepository(CompanyPlatformEntity)
    private readonly platforms: Repository<CompanyPlatformEntity>,
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
      },
      me: {
        memberId: tenant.memberId,
        roleKey: tenant.roleKey,
        roleName: tenant.roleName,
      },
      platforms,
    };
  }
}
