import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEntity } from './infrastructure/persistence/relational/entities/account.entity';

// Cash and bank accounts. Services arrive in Step 2/3; balances come from the
// ledger, never from this table.
@Module({
  imports: [TypeOrmModule.forFeature([AccountEntity])],
  exports: [TypeOrmModule],
})
export class AccountsModule {}
