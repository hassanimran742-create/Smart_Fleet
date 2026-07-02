import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InitTopupArgs, InitTopupResult, PaymentProvider } from '../payment-provider.interface';

@Injectable()
export class BankManualProvider implements PaymentProvider {
  name = 'BANK_MANUAL' as const;

  constructor(private cfg: ConfigService) {}

  async init(args: InitTopupArgs): Promise<InitTopupResult> {
    // Real bank details come from env so they're not hardcoded. Set:
    //   BANK_NAME, BANK_TITLE, BANK_IBAN  in .env.prod / .env.staging
    const bankName = this.cfg.get<string>('payments.bank.name') ?? process.env.BANK_NAME ?? 'Bank Al Habib';
    const title = this.cfg.get<string>('payments.bank.title') ?? process.env.BANK_TITLE ?? 'NIONSSTECH (PRIVATE) LIMITED';
    const iban = this.cfg.get<string>('payments.bank.iban') ?? process.env.BANK_IBAN ?? 'PK96BAHL0049098101379501';
    const amountRs = (Number(args.amountPaisa) / 100).toLocaleString();

    return {
      formFields: {
        instructions:
          `Transfer Rs. ${amountRs} to:\n` +
          `Bank: ${bankName}\n` +
          `Title: ${title}\n` +
          `IBAN: ${iban}\n\n` +
          `Use reference: ${args.paymentId.slice(0, 8)}\n` +
          `Then upload your receipt below.`,
      },
    };
  }

  async verifyWebhook() {
    return { providerTxnId: '', success: false, raw: {} };
  }
}
