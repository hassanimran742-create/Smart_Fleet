import type { PayerChannel, PaymentDto } from '@smartfleet/shared-types';
import i18n from '../../i18n';

/** How the distributor says they paid, in words ("Easypaisa"); null when they didn't say. */
export function channelWords(channel: PayerChannel | null | undefined): string | null {
  return channel ? i18n.t(`topups:channel.${channel}`) : null;
}

/** "Ali Raza · Easypaisa" (UX_ADMIN §2.2 "Paid from"): the payer and the channel, whichever are known. */
export function paidFromWords(payment: Pick<PaymentDto, 'payerName' | 'payerChannel'>): string {
  const name = payment.payerName?.trim() || null;
  const channel = channelWords(payment.payerChannel);
  if (name && channel) return i18n.t('topups:paidFrom', { name, channel });
  return name ?? channel ?? i18n.t('topups:table.none');
}
