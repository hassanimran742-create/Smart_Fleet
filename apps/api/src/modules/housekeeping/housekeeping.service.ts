import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Nightly clean-up (API_CONTRACT §8.5): purges expired OTP codes and old refresh tokens. It runs at
 * 03:00 Karachi time; HOUSEKEEPING_CRON may change the expression, never the time zone (ADR-21).
 * Audit logs and cylinder events are kept.
 */
@Injectable()
export class HousekeepingService {
  private readonly logger = new Logger(HousekeepingService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(process.env.HOUSEKEEPING_CRON ?? '0 3 * * *', { name: 'housekeeping-nightly', timeZone: 'Asia/Karachi' })
  async runNightly() {
    if (process.env.HOUSEKEEPING_DISABLED === '1') {
      this.logger.log('Housekeeping disabled via env');
      return;
    }
    this.logger.log('Housekeeping nightly run starting');
    const results = await Promise.allSettled([this.purgeExpiredOtp(), this.purgeExpiredRefreshTokens()]);
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.error(`Housekeeping job failed: ${r.reason}`);
      }
    }
    this.logger.log('Housekeeping nightly run complete');
  }

  /** OTP codes more than 10 minutes past their expiry, and used ones. */
  async purgeExpiredOtp() {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const res = await this.prisma.otpCode.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { not: null } }] },
    });
    this.logger.log({ deleted: res.count }, 'purged OTP codes');
    return res.count;
  }

  /** Expired refresh tokens, and tokens revoked more than 30 days ago. */
  async purgeExpiredRefreshTokens() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const res = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ revokedAt: { not: null, lt: cutoff } }, { expiresAt: { lt: new Date() } }],
      },
    });
    this.logger.log({ deleted: res.count }, 'purged refresh tokens');
    return res.count;
  }
}
