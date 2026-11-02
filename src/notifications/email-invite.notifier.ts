import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { AllConfigType } from '../config/config.type';
import { InviteNotifier } from './invite.notifier';

// Sends only when mail is configured, and never throws: a mail failure must
// not fail the invite, because the link is returned to the caller anyway.
@Injectable()
export class EmailInviteNotifier extends InviteNotifier {
  private readonly logger = new Logger(EmailInviteNotifier.name);

  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {
    super();
  }

  isEnabled(): boolean {
    return !!this.configService.get('mail.host', { infer: true });
  }

  async sendInvitation(data: {
    to: string;
    url: string;
    companyName: string;
    roleName: string;
  }): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      await this.mailService.companyInvitation({
        to: data.to,
        data: {
          url: data.url,
          companyName: data.companyName,
          roleName: data.roleName,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Invitation email not sent: ${(error as Error).message}`,
      );
    }
  }

  async sendPasswordLink(data: {
    to: string;
    url: string;
    companyName: string;
  }): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      await this.mailService.passwordLink({
        to: data.to,
        data: { url: data.url, companyName: data.companyName },
      });
    } catch (error) {
      this.logger.warn(
        `Password link email not sent: ${(error as Error).message}`,
      );
    }
  }
}
