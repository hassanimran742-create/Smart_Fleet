import { Injectable } from '@nestjs/common';
import { InitTopupArgs, InitTopupResult, PaymentProvider } from '../payment-provider.interface';

@Injectable()
export class BankManualProvider implements PaymentProvider {
  name = 'BANK_MANUAL' as const;

  async init(args: InitTopupArgs): Promise<InitTopupResult> {
    return {
      formFields: {
        instructions:
          'Transfer to: Smart_Fleet — Meezan Bank, IBAN PK00MEZN0001234567890. ' +
          `Reference: ${args.paymentId}. Then upload proof on the app.`,
      },
    };
  }

  async verifyWebhook() {
    return { providerTxnId: '', success: false, raw: {} };
  }
}
