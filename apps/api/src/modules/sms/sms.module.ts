import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SMS_PROVIDER, SmsService } from './sms.service';
import { MockSmsProvider } from './providers/mock-sms.provider';
import { EoceanSmsProvider } from './providers/eocean-sms.provider';

@Global()
@Module({
  providers: [
    SmsService,
    MockSmsProvider,
    EoceanSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, MockSmsProvider, EoceanSmsProvider],
      useFactory: (
        cfg: ConfigService,
        mock: MockSmsProvider,
        eocean: EoceanSmsProvider,
      ) => {
        const provider = cfg.get<string>('sms.provider');
        switch (provider) {
          case 'eocean':
            return eocean;
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
