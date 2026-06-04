import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

// Nightly cleanup jobs implementing the retention policy:
//   OTP codes        — purge expired (>10 min past expiry)
//   Refresh tokens   — purge revoked or expired (>30 days)
//   Audit log        — to be archived to R2 cold after 1 year (stubbed)
//   Custody events   — to be archived to R2 cold after 2 years (stubbed)
@Injectable()
export class HousekeepingService {
  private readonly logger = new Logger(HousekeepingService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(process.env.HOUSEKEEPING_CRON ?? '0 3 * * *', { name: 'housekeeping-nightly' })
  async runNightly() {
    if (process.env.HOUSEKEEPING_DISABLED === '1') {
      this.logger.log('Housekeeping disabled via env');
      return;
    }
    this.logger.log('Housekeeping nightly run starting');
    const results = await Promise.allSettled([
      this.purgeExpiredOtp(),
      this.purgeExpiredRefreshTokens(),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.error(`Housekeeping job failed: ${r.reason}`);
      }
    }
    this.logger.log('Housekeeping nightly run complete');
  }

  async purgeExpiredOtp() {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const res = await this.prisma.otpCode.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { not: null } }] },
    });
    this.logger.log({ deleted: res.count }, 'purged OTP codes');
    return res.count;
  }

  async purgeExpiredRefreshTokens() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const res = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { revokedAt: { not: null, lt: cutoff } },
          { expiresAt: { lt: new Date() } },
        ],
      },
    });
    this.logger.log({ deleted: res.count }, 'purged refresh tokens');
    return res.count;
  }
}
