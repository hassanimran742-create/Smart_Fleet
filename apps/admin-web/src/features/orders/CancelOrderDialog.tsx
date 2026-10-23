import { useEffect, useMemo, useRef, useState } from 'react';
import { ORDER_CANCEL_REASONS, type OrderCancelReason, type OrderCancelTerms, type OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { ApiError, errorDetails, messageFor } from '../../api/errors';
import { formatRs } from '../../i18n/format';
import { InlineAlert, useToast } from '../../ui';
import { useCancelOrder, useInvalidateOrder } from './api';
import { ReasonDialog } from './ReasonDialog';

type Variant = 'refund' | 'noRefund' | 'nothing';

/** The three cancel variants of UX_ADMIN §2.5, decided by the order's own cancel terms (never by a rule here). */
export function cancelVariant(terms: Pick<OrderCancelTerms, 'refundPaisa' | 'noRefundReason'>): Variant {
  if (terms.refundPaisa !== '0' && /^\d+$/.test(terms.refundPaisa)) return 'refund';
  if (terms.noRefundReason === 'DELIVERY_STARTED') return 'noRefund';
  return 'nothing';
}

function sameTerms(a: OrderCancelTerms, b: OrderCancelTerms): boolean {
  return a.refundPaisa === b.refundPaisa && a.noRefundReason === b.noRefundReason;
}

export interface CancelOrderDialogProps {
  /** The latest order the drawer has: its `cancel` terms decide the words and `confirmRefundPaisa`. */
  order: OrderDto;
  onClose: () => void;
}

/**
 * Cancel order (UX_ADMIN §2.5, ADR-07): a reason and a note of 5–300 characters, and the refund the
 * office saw, sent as `confirmRefundPaisa`. If the terms change while the dialog is open (a poll, or
 * the server's `ORDER_CANCEL_TERMS_CHANGED`), it re-renders with the new terms and says so, so nobody
 * confirms a refund that no longer applies. The money rule itself lives only on the server.
 */
export function CancelOrderDialog({ order, onClose }: CancelOrderDialogProps) {
  const { t } = useTranslation('orders');
  const toast = useToast();
  const cancel = useCancelOrder(order.id);
  const invalidate = useInvalidateOrder(order.id);
  const [terms, setTerms] = useState<OrderCancelTerms>(order.cancel);
  const [changed, setChanged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const termsRef = useRef(terms);
  termsRef.current = terms;

  // A newer read of the order (the drawer polls) with different terms re-renders the dialog, and a
  // different refund is said in the server's own words.
  useEffect(() => {
    const shown = termsRef.current;
    if (sameTerms(shown, order.cancel)) return;
    setTerms(order.cancel);
    if (order.cancel.refundPaisa !== shown.refundPaisa) setChanged(termsChangedMessage(order.cancel.refundPaisa));
  }, [order.cancel]);

  const variant = cancelVariant(terms);
  const amount = formatRs(terms.refundPaisa);
  const distributor = order.distributor?.businessName;

  const reasons = useMemo(
    () => ORDER_CANCEL_REASONS.map((code) => ({ value: code, label: t(`cancel.reason.${code}`) })),
    [t],
  );

  const body =
    variant === 'refund'
      ? distributor
        ? t('cancel.bodyRefund', { amount, distributor })
        : t('cancel.bodyRefundNoName', { amount })
      : variant === 'noRefund'
        ? t('cancel.bodyNoRefund')
        : t('cancel.bodyNothing');
  const confirmLabel =
    variant === 'refund'
      ? t('cancel.confirmRefund', { amount })
      : variant === 'noRefund'
        ? t('cancel.confirmNoRefund')
        : t('cancel.confirmNothing');

  const confirm = ({ reasonCode, note }: { reasonCode: OrderCancelReason | null; note: string }) => {
    if (!reasonCode) return;
    setError(null);
    cancel.mutate(
      { reasonCode, note, confirmRefundPaisa: terms.refundPaisa },
      {
        onSuccess: (result) => {
          const refunded = result.refundedPaisa !== '0' && /^\d+$/.test(result.refundedPaisa);
          const no = result.order?.shortCode ?? order.shortCode;
          toast.success(
            refunded
              ? t('cancel.toastReturned', { no, amount: formatRs(result.refundedPaisa) })
              : variant === 'nothing'
                ? t('cancel.toastDone', { no })
                : t('cancel.toastNoRefund', { no }),
          );
          void invalidate();
          onClose();
        },
        onError: (failure) => {
          const newTerms = errorDetails(failure, 'ORDER_CANCEL_TERMS_CHANGED');
          if (newTerms) {
            setTerms({
              allowed: true,
              refundPaisa: newTerms.refundPaisa,
              noRefundReason: newTerms.refundPaisa === '0' ? 'DELIVERY_STARTED' : null,
            });
            setChanged(messageFor(failure));
            void invalidate();
            return;
          }
          if (failure.is('ORDER_NOT_CANCELLABLE', 'ORDER_INVALID_TRANSITION', 'NOT_FOUND')) {
            // Finished meanwhile: the drawer shows its real stage.
            toast.error(failure);
            void invalidate();
            onClose();
            return;
          }
          setError(failure.is('ORDER_HANDOVER_STARTED') ? t('cancel.handoverStarted') : messageFor(failure));
          if (failure.is('ORDER_HANDOVER_STARTED')) void invalidate();
        },
      },
    );
  };

  return (
    <ReasonDialog<OrderCancelReason>
      title={t('cancel.title', { no: order.shortCode })}
      body={body}
      tone={variant === 'noRefund' ? 'danger' : 'default'}
      notice={
        changed ? (
          <InlineAlert tone="warning" live>
            {changed}
          </InlineAlert>
        ) : null
      }
      reasons={reasons}
      reasonLabel={t('cancel.reasonLabel')}
      noteLabel={t('cancel.noteLabel')}
      noteHint={t('cancel.noteHint')}
      noteMin={5}
      confirmLabel={confirmLabel}
      needReason={t('cancel.needReason')}
      needNote={t('cancel.needNote')}
      busy={cancel.isPending}
      error={error}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}

/** The catalogue's words for new terms: "Delivery has just started, so the refund is now Rs 0. …". */
function termsChangedMessage(refundPaisa: string): string {
  return messageFor(new ApiError('ORDER_CANCEL_TERMS_CHANGED', 409, { refundPaisa }, null, null));
}
