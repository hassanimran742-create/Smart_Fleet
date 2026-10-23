import { useRef, useState } from 'react';
import { TOPUP_REJECT_REASONS, type PaymentDto, type TopupRejectReason } from '@smartfleet/shared-types';
import { rejectTopupSchema } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { errorDetails, messageFor, toApiError, type ApiError } from '../../api/errors';
import { formatRs } from '../../i18n/format';
import { Button, Field, InlineAlert, Modal, RadioCards, Textarea } from '../../ui';
import { type ActionAnswer, useRejectTopup } from './api';

const NOTE_MAX = 300;
/** `OTHER` needs a note of 3–300 characters (API_CONTRACT §1.5). */
const NOTE_MIN = 3;

export interface RejectModalProps {
  payment: PaymentDto;
  distributor: string;
  onClose: () => void;
  /** The request was rejected (by this dialog, or already before it: `alreadyApplied`). */
  onRejected: (answer: ActionAnswer<{ payment: PaymentDto }>) => void;
  /** Someone else handled the request first (409 TOPUP_NOT_PENDING): the drawer says who and refetches. */
  onHandledElsewhere: (error: ApiError) => void;
}

/**
 * "Reject…" (UX_ADMIN §2.2): a reason as RadioCards, a note the distributor reads (required for Other),
 * and a preview of exactly what the shop app will show. No money moves.
 */
export function RejectModal({ payment, distributor, onClose, onRejected, onHandledElsewhere }: RejectModalProps) {
  const { t } = useTranslation(['topups', 'common', 'validation']);
  const reject = useRejectTopup(payment.id);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [reasonCode, setReasonCode] = useState<TopupRejectReason | null>(null);
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = note.trim();
  const body = { reasonCode: reasonCode ?? undefined, note: trimmed || undefined };
  const parsed = rejectTopupSchema.safeParse(body);
  const reasonError = reasonCode === null ? t('validation:INVALID_CHOICE') : null;
  const noteError =
    reasonCode === 'OTHER' && trimmed.length === 0
      ? t('validation:NOTE_REQUIRED', { min: NOTE_MIN })
      : trimmed.length > 0 && trimmed.length < NOTE_MIN
        ? t('validation:TOO_SHORT', { min: NOTE_MIN })
        : null;

  const submit = async () => {
    if (!parsed.success || reasonError || noteError || reasonCode === null) {
      setShowErrors(true);
      return;
    }
    setError(null);
    try {
      const answer = await reject.mutateAsync({ reasonCode, ...(trimmed ? { note: trimmed } : {}) });
      onRejected(answer);
    } catch (caught) {
      const apiError = toApiError(caught);
      if (errorDetails(apiError, 'TOPUP_NOT_PENDING')) {
        onHandledElsewhere(apiError);
        return;
      }
      setError(apiError.isNetwork ? t('drawer.offline') : messageFor(apiError));
    }
  };

  const amount = formatRs(payment.amountPaisa);
  const busy = reject.isPending;

  return (
    <Modal
      open
      size="md"
      title={t('reject.title', { distributor, amount })}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>
            {t('common:actions.goBack')}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void submit()}>
            {t('reject.confirm')}
          </Button>
        </>
      }
    >
      <Field label={t('reject.reasonLabel')} error={showErrors ? reasonError : null}>
        <RadioCards
          options={TOPUP_REJECT_REASONS.map((code) => ({ value: code, label: t(`reject.reasons.${code}`) }))}
          value={reasonCode}
          onChange={(code) => {
            setReasonCode(code);
            setError(null);
          }}
          columns={1}
        />
      </Field>
      <Field
        label={t('reject.note')}
        hint={t('reject.noteHint', { distributor })}
        optional={reasonCode !== 'OTHER'}
        error={showErrors ? noteError : null}
      >
        <Textarea value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <section className="sf-topups__preview" aria-live="polite">
        <h3 className="sf-topups__preview-title">{t('reject.previewTitle', { distributor })}</h3>
        {reasonCode ? (
          <>
            <p className="sf-topups__preview-line">{t(`reject.preview.${reasonCode}`)}</p>
            {trimmed ? <p className="sf-topups__preview-line">{t('reject.previewNote', { note: trimmed })}</p> : null}
          </>
        ) : (
          <p className="sf-topups__preview-empty">{t('reject.previewEmpty')}</p>
        )}
      </section>
      {error ? (
        <InlineAlert tone="danger" live>
          {error}
        </InlineAlert>
      ) : null}
    </Modal>
  );
}
