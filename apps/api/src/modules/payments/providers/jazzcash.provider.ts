import { Injectable } from '@nestjs/common';
import type { PaymentProvider } from '../payment-provider.interface';

/**
 * JazzCash, a GATEWAY provider kept registered but switched off (API_CONTRACT §5.7): no top-up can start
 * with it, and its callback route answers 410 PAYMENT_WEBHOOK_DISABLED.
 */
@Injectable()
export class JazzCashProvider implements PaymentProvider {
  readonly name = 'JAZZCASH' as const;
  readonly kind = 'GATEWAY' as const;

  async enabled(): Promise<boolean> {
    return false;
  }
}
