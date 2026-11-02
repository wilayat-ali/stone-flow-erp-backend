import { DeepPartial } from '../../../utils/types/deep-partial.type';
import { NullableType } from '../../../utils/types/nullable.type';
import { IPaginationOptions } from '../../../utils/types/pagination-options';
import { CompanyRole } from '../../domain/company-role';

export abstract class CompanyRoleRepository {
  abstract create(
    data: Omit<CompanyRole, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CompanyRole>;

  abstract findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }): Promise<CompanyRole[]>;

  abstract findById(id: CompanyRole['id']): Promise<NullableType<CompanyRole>>;

  abstract findByIds(ids: CompanyRole['id'][]): Promise<CompanyRole[]>;

  abstract update(
    id: CompanyRole['id'],
    payload: DeepPartial<CompanyRole>,
  ): Promise<CompanyRole | null>;

  abstract remove(id: CompanyRole['id']): Promise<void>;
}
