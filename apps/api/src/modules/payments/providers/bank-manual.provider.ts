import { Injectable } from '@nestjs/common';
import type { TopupAccount } from '@smartfleet/shared-types';
import { formatRs } from '@smartfleet/shared-utils';
import { AppError } from '../../../common/errors/app-error';
import { SettingsService } from '../../settings/settings.service';
import type { PaymentInstructions, PaymentProvider } from '../payment-provider.interface';

/**
 * The pilot's manual bank top-up (ADR-09). The company account is setting `topup.account`, set only by
 * the logged settings CLI; there is no fallback account in code. While it is unset, top-ups are closed
 * with 503 TOPUP_ACCOUNT_NOT_CONFIGURED.
 */
@Injectable()
export class BankManualProvider implements PaymentProvider {
  readonly name = 'BANK_MANUAL' as const;
  readonly kind = 'MANUAL_REVIEW' as const;

  constructor(private readonly settings: SettingsService) {}

  async enabled(): Promise<boolean> {
    return (await this.settings.get('topup.account')) !== null;
  }

  /** The company account, or 503 TOPUP_ACCOUNT_NOT_CONFIGURED. */
  async account(): Promise<TopupAccount> {
    const account = await this.settings.get('topup.account');
    if (!account) throw new AppError('TOPUP_ACCOUNT_NOT_CONFIGURED');
    return {
      accountTitle: account.accountTitle,
      bankName: account.bankName,
      iban: account.iban,
      accountNumber: account.accountNumber,
    };
  }

  async instructions(ctx: { distributorId: string; amountPaisa?: bigint; reference?: string }): Promise<PaymentInstructions> {
    const account = await this.account();
    const lines = [
      ctx.amountPaisa !== undefined ? `Transfer ${formatRs(ctx.amountPaisa)} to:` : 'Transfer the amount to:',
      `Bank: ${account.bankName}`,
      `Account title: ${account.accountTitle}`,
      `IBAN: ${account.iban}`,
      `Account number: ${account.accountNumber}`,
      '',
      ...(ctx.reference ? [`Use reference: ${ctx.reference}`] : []),
      'Then upload your receipt below.',
    ];
    return { account, text: lines.join('\n') };
  }
}
