import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, InlineAlert, Modal, RadioCards, Textarea } from '../../ui';

export interface ReasonOption<R extends string> {
  value: R;
  label: string;
}

export interface ReasonDialogProps<R extends string> {
  title: string;
  /** A notice above everything else, for example the new cancel terms. */
  notice?: ReactNode;
  /** What will happen, before the reason: the money line or the fact lines (UX_ADMIN §1.6: facts first). */
  facts: ReactNode;
  /** Reason codes to pick from, in 2 columns; leave out for a typed reason only. */
  reasons?: readonly ReasonOption<R>[];
  reasonLabel: string;
  /** The note's label (with reason cards) or the typed reason's label (without). */
  noteLabel: string;
  notePlaceholder?: string;
  /** Shortest note in characters (trimmed): 5 for an office cancel or not delivered, 10 for a manual delivery. */
  noteMin: number;
  noteMax?: number;
  noteRows?: number;
  /** The confirm button's words: a verb plus the amount or object ("Cancel and return Rs 330"). */
  confirmLabel: string;
  /** `danger` for a cancel that returns nothing. */
  confirmTone?: 'primary' | 'danger';
  /** Shown under the reasons when confirm is pressed with none picked. */
  needReason?: string;
  /** Shown under the note when confirm is pressed with it too short. */
  needNote: string;
  busy: boolean;
  /** The server's refusal, shown inside the dialog. */
  error: string | null;
  onConfirm: (input: { reasonCode: R | null; note: string }) => void;
  onClose: () => void;
}

/**
 * The office's reason dialogs on an order (UX_ADMIN §2.5, website spec W30–W32): Cancel order, Could
 * not deliver and Mark delivered. The facts come first, then the reason cards and the note the server
 * requires. "Go back" has the focus. The confirm button stays enabled: pressed with something missing,
 * each missing part says so under itself and the focus moves to the first (UX_ADMIN §1.7). It shows a
 * spinner while sending, so a double submit is impossible, and a refusal stays inside the dialog with
 * what was typed kept. No browser pop-ups.
 */
export function ReasonDialog<R extends string>({
  title,
  notice,
  facts,
  reasons,
  reasonLabel,
  noteLabel,
  notePlaceholder,
  noteMin,
  noteMax = 300,
  noteRows = 2,
  confirmLabel,
  confirmTone = 'primary',
  needReason,
  needNote,
  busy,
  error,
  onConfirm,
  onClose,
}: ReasonDialogProps<R>) {
  const { t } = useTranslation('common');
  const goBackRef = useRef<HTMLButtonElement>(null);
  const reasonsRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [reasonCode, setReasonCode] = useState<R | null>(null);
  const [note, setNote] = useState('');
  /** Confirm was pressed with something missing: the missing parts say so until they are fixed. */
  const [pressed, setPressed] = useState(false);
  const trimmed = note.trim();

  const reasonMissing = Boolean(reasons) && reasonCode === null;
  const noteShort = trimmed.length < noteMin;

  const confirm = () => {
    if (busy) return;
    if (reasonMissing || noteShort) {
      setPressed(true);
      if (reasonMissing) reasonsRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
      else noteRef.current?.focus();
      return;
    }
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
          <Button variant={confirmTone} loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="sf-order-dialog">
        {notice}
        {facts}
        {reasons ? (
          <Field label={reasonLabel} error={pressed && reasonMissing ? (needReason ?? null) : null}>
            <div ref={reasonsRef}>
              <RadioCards options={reasons} value={reasonCode} onChange={setReasonCode} columns={2} />
            </div>
          </Field>
        ) : null}
        <Field label={noteLabel} error={pressed && noteShort ? needNote : null}>
          <Textarea
            ref={noteRef}
            value={note}
            maxLength={noteMax}
            rows={noteRows}
            placeholder={notePlaceholder}
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
