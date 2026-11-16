import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalService } from './approval.service';
import { ApprovalEntity } from './infrastructure/persistence/relational/entities/approval.entity';

// The shared approval pattern, used by cash & bank, purchasing and stock entries.
@Module({
  imports: [TypeOrmModule.forFeature([ApprovalEntity])],
  providers: [ApprovalService],
  exports: [ApprovalService, TypeOrmModule],
})
export class ApprovalsModule {}
