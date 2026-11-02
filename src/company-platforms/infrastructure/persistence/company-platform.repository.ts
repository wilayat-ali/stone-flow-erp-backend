import { DeepPartial } from '../../../utils/types/deep-partial.type';
import { NullableType } from '../../../utils/types/nullable.type';
import { IPaginationOptions } from '../../../utils/types/pagination-options';
import { CompanyPlatform } from '../../domain/company-platform';

export abstract class CompanyPlatformRepository {
  abstract create(
    data: Omit<CompanyPlatform, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CompanyPlatform>;

  abstract findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }): Promise<CompanyPlatform[]>;

  abstract findById(
    id: CompanyPlatform['id'],
  ): Promise<NullableType<CompanyPlatform>>;

  abstract findByIds(ids: CompanyPlatform['id'][]): Promise<CompanyPlatform[]>;

  abstract update(
    id: CompanyPlatform['id'],
    payload: DeepPartial<CompanyPlatform>,
  ): Promise<CompanyPlatform | null>;

  abstract remove(id: CompanyPlatform['id']): Promise<void>;
}
