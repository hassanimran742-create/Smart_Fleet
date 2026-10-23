import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfirmationService } from './confirmation.contract';

/** The job's name in the scheduler registry (API_CONTRACT §9.9). */
export const CONFIRMATION_EXPIRY_JOB = 'confirmation-expiry';

/**
 * Every 15 minutes, Pakistan time (API_CONTRACT §9.9): PENDING links past `expires_at` become EXPIRED,
 * whether `confirmation.enabled` is on or off. Nothing else changes: no money, no case, no message.
 * (The page already answers "expired" from the moment a link passes its expiry; the job makes the
 * stored status match.)
 */
@Injectable()
export class ConfirmationExpiryJob {
  private readonly logger = new Logger('ConfirmationExpiry');

  constructor(private readonly confirmations: ConfirmationService) {}

  @Cron('*/15 * * * *', { name: 'confirmation-expiry', timeZone: 'Asia/Karachi' })
  async scheduled(): Promise<void> {
    await this.run();
  }

  /** One run: how many links it closed. Never throws (the next run tries again). */
  async run(now: Date = new Date()): Promise<number> {
    try {
      return await this.confirmations.expireDue(now);
    } catch (error) {
      this.logger.error(`confirmation expiry failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
}
