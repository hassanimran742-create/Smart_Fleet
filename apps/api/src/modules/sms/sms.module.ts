import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SMS_PROVIDER, SmsService } from './sms.service';
import { MockSmsProvider } from './providers/mock-sms.provider';

@Global()
@Module({
  providers: [
    SmsService,
    MockSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, MockSmsProvider],
      useFactory: (cfg: ConfigService, mock: MockSmsProvider) => {
        const provider = cfg.get<string>('sms.provider');
        switch (provider) {
          case 'mock':
          default:
            return mock;
        }
      },
    },
  ],
  exports: [SmsService],
})
export class SmsModule {}
