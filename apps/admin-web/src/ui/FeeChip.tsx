import { Minus, Undo2, Wallet } from 'lucide-react';
import type { OrderFeeStatus, Paisa } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { formatRs } from '../i18n/format';
import { Chip } from './StatusChip';

export interface FeeChipProps {
  /** The order's delivery cost (`fee.totalPaisa`). */
  amountPaisa: Paisa | null | undefined;
  status: OrderFeeStatus;
  className?: string;
}

/**
 * An order's delivery cost (UX_ADMIN §1.5): "Rs 330 paid" (taken from the wallet when the order was
 * placed), "Rs 330 returned" (cancelled before delivery started) or "No fee". It never says "on hold".
 */
export function FeeChip({ amountPaisa, status, className }: FeeChipProps) {
  const { t } = useTranslation('status');
  const amount = formatRs(amountPaisa ?? null);
  if (status === 'DEDUCTED') {
    return (
      <Chip tone="neutral" icon={Wallet} className={className}>
        {t('fee.DEDUCTED', { amount })}
      </Chip>
    );
  }
  if (status === 'REVERSED') {
    return (
      <Chip tone="success" icon={Undo2} className={className}>
        {t('fee.REVERSED', { amount })}
      </Chip>
    );
  }
  return (
    <Chip tone="neutral" icon={Minus} className={className}>
      {t('fee.NONE')}
    </Chip>
  );
}
