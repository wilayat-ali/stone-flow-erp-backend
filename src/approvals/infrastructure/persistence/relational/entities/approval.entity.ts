import { CompanyMemberEntity } from '../../../../../company-members/infrastructure/persistence/relational/entities/company-member.entity';

import { CompanyEntity } from '../../../../../companies/infrastructure/persistence/relational/entities/company.entity';

import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  Column,
  Check,
  Index,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

// Generic pending/approved/rejected record for any entry that waits for a
// second person. Owner entries are stored already approved with no decider.
@Entity({
  name: 'approval',
})
@Check('CHK_approval_status', `"status" IN ('pending', 'approved', 'rejected')`)
@Check(
  'CHK_approval_decided',
  `("status" = 'pending' AND "decidedAt" IS NULL) OR ("status" IN ('approved', 'rejected') AND "decidedAt" IS NOT NULL)`,
)
// Nobody approves or rejects their own entry (rules §1).
@Check(
  'CHK_approval_not_self',
  `"decidedByMemberId" IS NULL OR "decidedByMemberId" <> "requestedByMemberId"`,
)
// A rejection always keeps a reason the munshi can read.
@Check(
  'CHK_approval_reject_reason',
  `"status" <> 'rejected' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)`,
)
@Index('IDX_approval_status', ['company', 'status'])
@Index('IDX_approval_entity', ['company', 'entityType', 'entityId'])
export class ApprovalEntity extends EntityRelationalHelper {
  // What was asked for, held here until approval so that a pending entry
  // never touches a balance or stock. Posted by the owning service on approve.
  @Column({
    nullable: true,
    type: 'jsonb',
  })
  payload?: Record<string, unknown> | null;

  @Column({
    nullable: true,
    type: String,
  })
  reason?: string | null;

  @Column({
    nullable: true,
    type: Date,
  })
  decidedAt?: Date | null;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: true })
  decidedByMember?: CompanyMemberEntity | null;

  @ManyToOne(() => CompanyMemberEntity, { eager: false, nullable: false })
  requestedByMember?: CompanyMemberEntity;

  @Column({
    nullable: false,
    type: String,
    default: 'pending',
  })
  status: string;

  // The record the approval is about, once it exists (null while only the
  // payload exists, e.g. a pending Other Payment).
  @Column({
    nullable: true,
    type: 'uuid',
  })
  entityId?: string | null;

  @Column({
    nullable: false,
    type: String,
  })
  entityType: string;

  @ManyToOne(() => CompanyEntity, { eager: false, nullable: false })
  company?: CompanyEntity;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
