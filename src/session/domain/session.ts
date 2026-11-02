import { Company } from '../../companies/domain/company';
import { User } from '../../users/domain/user';

export class Session {
  id: number | string;
  user: User;
  hash: string;
  activeCompany?: Company | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;
}
