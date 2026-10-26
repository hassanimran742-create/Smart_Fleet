import { Injectable } from '@nestjs/common';
import type { PaymentProvider } from '../payment-provider.interface';

/**
 * Easypaisa, a GATEWAY provider for later (ADR-09, API_CONTRACT §5.7). It stays registered but switched
 * off: no top-up can start with it, and its callback route answers 410 PAYMENT_WEBHOOK_DISABLED. When it
 * is built it credits through the same TopupService path, after `inquire`.
 */
@Injectable()
export class EasypaisaProvider implements PaymentProvider {
  readonly name = 'EASYPAISA' as const;
  readonly kind = 'GATEWAY' as const;

  async enabled(): Promise<boolean> {
    return false;
  }
}
