import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { EmailInviteNotifier } from './email-invite.notifier';
import { InviteNotifier } from './invite.notifier';

@Module({
  imports: [ConfigModule, MailModule],
  providers: [{ provide: InviteNotifier, useClass: EmailInviteNotifier }],
  exports: [InviteNotifier],
})
export class NotificationsModule {}
