/**
 * Messaging [Inc 2] (docs/pilot/CUSTOMER_PAGE.md §8, API_CONTRACT §5.9, ADR-20): the cross-lane entry
 * point. Every name other lanes and tests import is re-exported here (the contract is in
 * messaging.contract.ts, the real service in messaging.service.ts, the SMS text in sms-text.ts), and
 * the global module is defined here, so app.module.ts keeps its import.
 *
 * What the module provides:
 * - `MESSAGING_PROVIDER`: the live provider, chosen by env `MESSAGING_PROVIDER` (default `mock`; an
 *   unknown name refuses to boot). Tests override it with a spy "real" provider.
 * - `MessagingService` → `MessagingServiceImpl`: the outbound_messages log (record, in the caller's
 *   transaction) and the after-commit send with test mode in front of the provider.
 */
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chooseMessagingProvider, MESSAGING_PROVIDER, MessagingService, MockMessagingProvider } from './messaging.contract';
import { MessagingServiceImpl } from './messaging.service';

export * from './messaging.contract';
export { MessagingServiceImpl, PROVIDER_TIMEOUT_MS } from './messaging.service';
export {
  isGsm7Basic,
  redactLinkToken,
  renderSms,
  smsShopName,
  SMS_MAX_LENGTH,
  SMS_SHOP_FALLBACK,
  SMS_SHOP_MAX,
  type RenderedSms,
  type SmsParts,
} from './sms-text';

/** Global, so the confirmation module and any later sender inject `MessagingService` without imports. */
@Global()
@Module({
  providers: [
    MockMessagingProvider,
    {
      provide: MESSAGING_PROVIDER,
      inject: [ConfigService, MockMessagingProvider],
      useFactory: (config: ConfigService, mock: MockMessagingProvider) =>
        chooseMessagingProvider(config.get<string>('MESSAGING_PROVIDER'), { mock }),
    },
    MessagingServiceImpl,
    { provide: MessagingService, useExisting: MessagingServiceImpl },
  ],
  exports: [MessagingService, MessagingServiceImpl, MESSAGING_PROVIDER],
})
export class MessagingModule {}
