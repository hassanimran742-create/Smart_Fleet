import { Inject, Injectable } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

@Injectable()
export class SmsService {
  constructor(@Inject(SMS_PROVIDER) private readonly provider: SmsProvider) {}

  send(to: string, body: string) {
    return this.provider.send(to, body);
  }

  sendOtp(to: string, code: string) {
    return this.send(to, `Smart_Fleet code: ${code}. Valid 5 min.`);
  }
}
