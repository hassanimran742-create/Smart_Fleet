import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SmsProvider } from '../sms-provider.interface';

// Mock SMS provider for pilot mode (no real SMS gateway).
// The operator reads OTPs from log output (Railway Logs tab / Axiom / etc.)
// and shares them with users out-of-band (WhatsApp, Telegram, in-person).
//
// In non-production environments the SmsService also returns the code in the
// API response so mobile/admin can auto-fill it during testing.
@Injectable()
export class MockSmsProvider implements SmsProvider {
  private logger = new Logger('MockSMS');
  private warnedProd = false;

  async send(to: string, body: string) {
    const id = randomUUID();
    if (process.env.NODE_ENV === 'production' && !this.warnedProd) {
      this.logger.warn(
        '[!!] MockSmsProvider active in production. OTPs are visible only in logs. ' +
          'Set SMS_PROVIDER=<real-provider> when going live.',
      );
      this.warnedProd = true;
    }

    // High-visibility multi-line block so operators can grep "OTP-MOCK" in logs.
    this.logger.log(
      '\n' +
        '════════ OTP-MOCK ════════\n' +
        `  to:   ${to}\n` +
        `  msg:  ${body}\n` +
        `  id:   ${id}\n` +
        '══════════════════════════',
    );
    return { id };
  }
}
