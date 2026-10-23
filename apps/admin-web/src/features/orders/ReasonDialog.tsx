import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, cx, Field, InlineAlert, Modal, RadioCards, Textarea } from '../../ui';

export interface ReasonOption<R extends string> {
  value: R;
  label: string;
}

export interface ReasonDialogProps<R extends string> {
  title: string;
  /** What will happen; `danger` draws it in the danger colour (for example "Cancelling now returns nothing"). */
  body: ReactNode;
  tone?: 'default' | 'danger';
  /** A notice above the form, for example new cancel terms. */
  notice?: ReactNode;
  /** Reason codes to pick from; leave out for a free-text reason only. */
  reasons?: readonly ReasonOption<R>[];
  reasonLabel: string;
  noteLabel: string;
  noteHint?: string;
  /** Shortest note in characters (trimmed): 5 for an office cancel or fail, 10 for a manual delivery. */
  noteMin: number;
  noteMax?: number;
  /** The confirm button's words: a verb plus the amount or object ("Cancel and return Rs 330"). */
  confirmLabel: string;
  /** Why the confirm button is disabled while nothing is picked, and while the note is too short. */
  needReason?: string;
  needNote: string;
  busy: boolean;
  /** The server's refusal, shown inside the dialog. */
  error: string | null;
  onConfirm: (input: { reasonCode: R | null; note: string }) => void;
  onClose: () => void;
}

/**
 * The office's reason dialogs on an order (UX_ADMIN §2.5): Cancel order, Could not deliver and Mark
 * delivered by office. "Go back" has the focus; confirm stays disabled, saying why, until a reason is
 * picked and the note is long enough; it shows a spinner while sending, so a double submit is
 * impossible, and a refusal stays inside the dialog with what was typed kept. No browser pop-ups.
 */
export function ReasonDialog<R extends string>({
  title,
  body,
  tone = 'default',
  notice,
  reasons,
  reasonLabel,
  noteLabel,
  noteHint,
  noteMin,
  noteMax = 300,
  confirmLabel,
  needReason,
  needNote,
  busy,
  error,
  onConfirm,
  onClose,
}: ReasonDialogProps<R>) {
  const { t } = useTranslation('common');
  const goBackRef = useRef<HTMLButtonElement>(null);
  const [reasonCode, setReasonCode] = useState<R | null>(null);
  const [note, setNote] = useState('');
  const trimmed = note.trim();

  const blocked =
    reasons && reasonCode === null ? (needReason ?? needNote) : trimmed.length < noteMin ? needNote : null;

  const confirm = () => {
    if (blocked || busy) return;
    onConfirm({ reasonCode, note: trimmed });
  };

  return (
    <Modal
      open
      role="alertdialog"
      size="md"
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      initialFocusRef={goBackRef}
      footer={
        <>
          <Button ref={goBackRef} onClick={onClose} disabled={busy}>
            {t('actions.goBack')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            disabled={blocked !== null}
            disabledReason={blocked ?? undefined}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="sf-order-dialog">
        {notice}
        <p className={cx('sf-order-dialog__body', tone === 'danger' && 'is-danger')}>{body}</p>
        {reasons ? (
          <Field label={reasonLabel}>
            <RadioCards options={reasons} value={reasonCode} onChange={setReasonCode} columns={2} />
          </Field>
        ) : null}
        <Field label={reasons ? noteLabel : reasonLabel} hint={noteHint}>
          <Textarea
            value={note}
            maxLength={noteMax}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
          />
        </Field>
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
      </div>
    </Modal>
  );
}
