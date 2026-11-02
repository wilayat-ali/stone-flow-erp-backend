import { Session } from '../../../session/domain/session';
import { User } from '../../../users/domain/user';

export type JwtPayloadType = Pick<User, 'id' | 'role'> & {
  // 'user' for business users. Super admin tokens use their own secret and
  // type, so they can never pass the user strategy.
  typ: 'user';
  sessionId: Session['id'];
  // Set only when the token is scoped to a company.
  companyId?: string;
  memberId?: string;
  roleKey?: string;
  iat: number;
  exp: number;
};
