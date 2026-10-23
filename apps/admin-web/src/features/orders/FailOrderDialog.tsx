import { useMemo, useState } from 'react';
import { DELIVERY_FAILURE_REASONS, type DeliveryFailureReason, type OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../../api/errors';
import { formatRs } from '../../i18n/format';
import { useToast } from '../../ui';
import { useFailOrder, useInvalidateOrder } from './api';
import { ReasonDialog } from './ReasonDialog';

/**
 * Could not deliver (UX_ADMIN §2.5): offered only once delivery has started (`MARK_FAILED` in the
 * order's `allowedActions`). A reason and a note of 5–300 characters; no money moves.
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
      body={charged ? t('fail.body', { amount: formatRs(order.fee.totalPaisa) }) : t('fail.bodyNoCost')}
      reasons={reasons}
      reasonLabel={t('cancel.reasonLabel')}
      noteLabel={t('cancel.noteLabel')}
      noteHint={t('cancel.noteHint')}
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
