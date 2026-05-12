import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SmsProvider } from '../sms-provider.interface';

@Injectable()
export class MockSmsProvider implements SmsProvider {
  private logger = new Logger('MockSMS');

  async send(to: string, body: string) {
    const id = randomUUID();
    this.logger.log(`SMS to ${to} [id=${id}]: ${body}`);
    return { id };
  }
}
