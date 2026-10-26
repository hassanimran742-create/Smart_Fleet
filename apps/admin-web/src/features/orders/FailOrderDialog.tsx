import { useMemo, useState } from 'react';
import { Truck, Wallet } from 'lucide-react';
import { DELIVERY_FAILURE_REASONS, type DeliveryFailureReason, type OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../../api/errors';
import { formatRs } from '../../i18n/format';
import { flashRow, useToast } from '../../ui';
import { useFailOrder, useInvalidateOrder } from './api';
import { ReasonDialog } from './ReasonDialog';

/**
 * Could not deliver (UX_ADMIN §2.5, website spec W31): offered only once delivery has started
 * (`MARK_FAILED` in the order's `allowedActions`). Two fact lines (the cost stays paid; the driver
 * brings the cylinders back), a reason and a note of 5–300 characters ("What happened?": the office's
 * note stays required, DECIDED). No money moves. The drawer stays open on the order.
 */
export function FailOrderDialog({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const { t } = useTranslation('orders');
  const toast = useToast();
  const fail = useFailOrder(order.id);
  const invalidate = useInvalidateOrder(order.id);
  const [error, setError] = useState<string | null>(null);

  const reasons = useMemo(
    () => DELIVERY_FAILURE_REASONS.map((code) => ({ value: code, label: t(`fail.reason.${code}`) })),
    [t],
  );
  const charged = order.fee.status === 'DEDUCTED' && order.fee.totalPaisa !== '0';

  const confirm = ({ reasonCode, note }: { reasonCode: DeliveryFailureReason | null; note: string }) => {
    if (!reasonCode) return;
    setError(null);
    fail.mutate(
      { reasonCode, note },
      {
        onSuccess: (updated) => {
          toast.success(t('fail.toast', { no: updated.shortCode ?? order.shortCode }));
          flashRow('orders', order.id);
          void invalidate();
          onClose();
        },
        onError: (failure) => {
          if (failure.is('ORDER_INVALID_TRANSITION', 'NOT_FOUND')) {
            toast.error(failure);
            void invalidate();
            onClose();
            return;
          }
          setError(failure.is('ORDER_HANDOVER_STARTED') ? t('cancel.handoverStarted') : messageFor(failure));
          if (failure.is('ORDER_NOT_STARTED_USE_CANCEL', 'ORDER_HANDOVER_STARTED')) void invalidate();
        },
      },
    );
  };

  return (
    <ReasonDialog<DeliveryFailureReason>
      title={t('fail.title', { no: order.shortCode })}
      facts={
        <ul className="sf-order-dialog__facts">
          {charged ? (
            <li className="sf-order-dialog__fact">
              <Wallet aria-hidden size={16} strokeWidth={2} />
              <span>{t('fail.facts.money', { amount: formatRs(order.fee.totalPaisa) })}</span>
            </li>
          ) : null}
          <li className="sf-order-dialog__fact">
            <Truck aria-hidden size={16} strokeWidth={2} />
            <span>{t('fail.facts.driver')}</span>
          </li>
        </ul>
      }
      reasons={reasons}
      reasonLabel={t('cancel.reasonLabel')}
      noteLabel={t('cancel.noteLabel')}
      notePlaceholder={t('fail.notePlaceholder')}
      noteMin={5}
      confirmLabel={t('fail.confirm')}
      needReason={t('cancel.needReason')}
      needNote={t('cancel.needNote')}
      busy={fail.isPending}
      error={error}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
