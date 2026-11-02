import { DeepPartial } from '../../../utils/types/deep-partial.type';
import { NullableType } from '../../../utils/types/nullable.type';
import { IPaginationOptions } from '../../../utils/types/pagination-options';
import { CompanyInvitation } from '../../domain/company-invitation';

export abstract class CompanyInvitationRepository {
  abstract create(
    data: Omit<CompanyInvitation, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CompanyInvitation>;

  abstract findAllWithPagination({
    paginationOptions,
  }: {
    paginationOptions: IPaginationOptions;
  }): Promise<CompanyInvitation[]>;

  abstract findById(
    id: CompanyInvitation['id'],
  ): Promise<NullableType<CompanyInvitation>>;

  abstract findByIds(
    ids: CompanyInvitation['id'][],
  ): Promise<CompanyInvitation[]>;

  abstract update(
    id: CompanyInvitation['id'],
    payload: DeepPartial<CompanyInvitation>,
  ): Promise<CompanyInvitation | null>;

  abstract remove(id: CompanyInvitation['id']): Promise<void>;
}
