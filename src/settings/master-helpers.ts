import { ObjectLiteral, Repository } from 'typeorm';
import { conflict } from '../engines/errors';

// Names in one list are unique per company, ignoring case, so two people
// cannot add the same factory or rate twice. Inactive rows still count: the
// name is only hidden, not freed.
export async function assertNameFree(
  repo: Repository<ObjectLiteral>,
  companyId: string,
  name: string,
  options: {
    exceptId?: string;
    /** Narrow the check to one list, e.g. `r."kind" = :kind`. */
    where?: string;
    params?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const query = repo
    .createQueryBuilder('r')
    .where('r."companyId" = :companyId AND LOWER(r."name") = LOWER(:name)', {
      companyId,
      name,
    });

  if (options.where) {
    query.andWhere(options.where, options.params);
  }
  if (options.exceptId) {
    query.andWhere('r.id <> :exceptId', { exceptId: options.exceptId });
  }

  if (await query.getExists()) {
    throw conflict('DUPLICATE_NAME');
  }
}
