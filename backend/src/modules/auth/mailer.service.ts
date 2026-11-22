import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '@/config/config.module';
import { Env } from '@/config/env';

/**
 * Outbound email port.
 *
 * No email provider is configured in this project, so this implementation does NOT send
 * anything: outside production it writes the message (including the action link) to the
 * server log so the password-reset and verification flows can be exercised locally.
 * Replace `send` with a real provider (SES, Postmark, …) before going live — the callers
 * and the token lifecycle do not change.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger('Mailer');
  /** Last message per recipient; lets automated tests follow the link without an inbox. */
  readonly outbox = new Map<string, { subject: string; link: string }>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(to: string, subject: string, link: string): Promise<void> {
    if (this.env.NODE_ENV === 'production') {
      this.logger.warn(`Email delivery is not configured; "${subject}" for ${to.replace(/^(.).*(@.*)$/, '$1***$2')} was not sent.`);
      return;
    }
    this.outbox.set(to, { subject, link });
    if (this.env.NODE_ENV !== 'test') this.logger.log(`[dev email — not actually sent] to=${to} subject="${subject}" link=${link}`);
  }
}
