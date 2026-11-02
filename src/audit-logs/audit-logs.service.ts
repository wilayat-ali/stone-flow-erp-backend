import { CompaniesService } from '../companies/companies.service';
import { Company } from '../companies/domain/company';

import {
  // common
  Injectable,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { UpdateAuditLogDto } from './dto/update-audit-log.dto';
import { AuditLogRepository } from './infrastructure/persistence/audit-log.repository';
import { IPaginationOptions } from '../utils/types/pagination-options';
import { AuditLog } from './domain/audit-log';

@Injectable()
export class AuditLogsService {
  constructor(
    private readonly companyService: CompaniesService,

    // Dependencies here
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async create(createAuditLogDto: CreateAuditLogDto) {
    // Do not remove comment below.
    // <creating-property />

    let company: Company | null | undefined = undefined;

    if (createAuditLogDto.company) {
      const companyObject = await this.companyService.findById(
        createAuditLogDto.company.id,
      );
      if (!companyObject) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            company: 'notExists',
          },
        });
      }
      company = companyObject;
    } else if (createAuditLogDto.company === null) {
      company = null;
    }

    return this.auditLogRepository.create({
      // Do not remove comment below.
      // <creating-property-payload />
      metadata: createAuditLogDto.metadata,

      targetId: createAuditLogDto.targetId,

      targetType: createAuditLogDto.targetType,

      company,

      action: createAuditLogDto.action,

      actorId: createAuditLogDto.actorId,

      actorType: createAuditLogDto.actorType,
    });
  }

  findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }) {
    return this.auditLogRepository.findAllWithPagination({
      paginationOptions: {
        page: paginationOptions.page,
        limit: paginationOptions.limit,
      },
    });
  }

  findById(id: AuditLog['id']) {
    return this.auditLogRepository.findById(id);
  }

  findByIds(ids: AuditLog['id'][]) {
    return this.auditLogRepository.findByIds(ids);
  }

  async update(
    id: AuditLog['id'],

    updateAuditLogDto: UpdateAuditLogDto,
  ) {
    // Do not remove comment below.
    // <updating-property />

    let company: Company | null | undefined = undefined;

    if (updateAuditLogDto.company) {
      const companyObject = await this.companyService.findById(
        updateAuditLogDto.company.id,
      );
      if (!companyObject) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            company: 'notExists',
          },
        });
      }
      company = companyObject;
    } else if (updateAuditLogDto.company === null) {
      company = null;
    }

    return this.auditLogRepository.update(id, {
      // Do not remove comment below.
      // <updating-property-payload />
      metadata: updateAuditLogDto.metadata,

      targetId: updateAuditLogDto.targetId,

      targetType: updateAuditLogDto.targetType,

      company,

      action: updateAuditLogDto.action,

      actorId: updateAuditLogDto.actorId,

      actorType: updateAuditLogDto.actorType,
    });
  }

  remove(id: AuditLog['id']) {
    return this.auditLogRepository.remove(id);
  }
}
