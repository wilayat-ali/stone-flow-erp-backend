import { DeepPartial } from '../../../utils/types/deep-partial.type';
import { NullableType } from '../../../utils/types/nullable.type';
import { IPaginationOptions } from '../../../utils/types/pagination-options';
import { SuperAdmin } from '../../domain/super-admin';

export abstract class SuperAdminRepository {
  abstract create(
    data: Omit<SuperAdmin, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SuperAdmin>;

  abstract findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }): Promise<SuperAdmin[]>;

  abstract findById(id: SuperAdmin['id']): Promise<NullableType<SuperAdmin>>;

  abstract findByIds(ids: SuperAdmin['id'][]): Promise<SuperAdmin[]>;

  abstract update(
    id: SuperAdmin['id'],
    payload: DeepPartial<SuperAdmin>,
  ): Promise<SuperAdmin | null>;

  abstract remove(id: SuperAdmin['id']): Promise<void>;
}
