import { useState } from 'react';
import type { OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../../api/errors';
import { useToast } from '../../ui';
import { useInvalidateOrder, useManualDelivery } from './api';
import { ReasonDialog } from './ReasonDialog';

/**
 * Mark delivered by office (UX_ADMIN §2.5, the Inc 1 manual delivery): a reason of at least 10
 * characters, logged with the office user's name. No money moves. A repeat (`X-Already-Applied`)
 * shows the same toast; an order the driver already delivered refetches, so the drawer shows it.
 */
export function ManualDeliveryDialog({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const { t } = useTranslation('orders');
  const toast = useToast();
  const deliver = useManualDelivery(order.id);
  const invalidate = useInvalidateOrder(order.id);
  const [error, setError] = useState<string | null>(null);

  const confirm = ({ note }: { note: string }) => {
    setError(null);
    deliver.mutate(
      { reason: note },
      {
        onSuccess: (updated) => {
          toast.success(t('manual.toast', { no: updated.shortCode ?? order.shortCode }));
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
          setError(messageFor(failure));
        },
      },
    );
  };

  return (
    <ReasonDialog
      title={t('manual.title', { no: order.shortCode })}
      body={t('manual.body')}
      reasonLabel={t('manual.reasonLabel')}
      noteLabel={t('manual.reasonLabel')}
      noteHint={t('manual.reasonHint')}
      noteMin={10}
      confirmLabel={t('manual.confirm')}
      needNote={t('manual.needReason')}
      busy={deliver.isPending}
      error={error}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
