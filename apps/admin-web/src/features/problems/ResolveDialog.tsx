import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CaseDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../../api/errors';
import { Button, Field, InlineAlert, Modal, Textarea } from '../../ui';
import { invalidateProblems, useResolveProblem } from './api';

/** The resolve note: 5–300 characters after trimming (API_CONTRACT §9.6). */
const NOTE_MIN = 5;
const NOTE_MAX = 300;

export interface ResolveDialogProps {
  problem: CaseDto;
  onClose: () => void;
  /** After the close is recorded (or was already recorded by this office user). */
  onSorted: (problem: CaseDto) => void;
}

/**
 * Mark as sorted (UX_ADMIN §3.3, Inc 2/3 spec §3.1): a small form, because the API needs a note of what
 * the office did, and those words only the office knows. It is the only action on a problem: no refund,
 * charge or correction (ADR-15). The main button stays enabled: pressed with too short a note, the field
 * says so. Closed meanwhile by someone else (`CASE_ALREADY_RESOLVED`): the dialog says who, the list
 * refreshes, and the one button becomes "Close".
 */
export function ResolveDialog({ problem, onClose, onSorted }: ResolveDialogProps) {
  const { t } = useTranslation(['problems', 'common', 'validation']);
  const queryClient = useQueryClient();
  const resolve = useResolveProblem(problem.id);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState('');
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Someone else closed it meanwhile: nothing is left to do here. */
  const [closedElsewhere, setClosedElsewhere] = useState(false);
  const trimmed = note.trim();
  const tooShort = trimmed.length < NOTE_MIN;
  const busy = resolve.isPending;

  // The note box goes once there is nothing left to do: the focus moves to "Close".
  useEffect(() => {
    if (closedElsewhere) closeRef.current?.focus();
  }, [closedElsewhere]);

  const confirm = () => {
    if (busy) return;
    if (tooShort) {
      setPressed(true);
      noteRef.current?.focus();
      return;
    }
    setError(null);
    resolve.mutate(
      { note: trimmed },
      {
        onSuccess: () => {
          void invalidateProblems(queryClient);
          onSorted(problem);
        },
        onError: (failure) => {
          setError(messageFor(failure));
          if (failure.is('CASE_ALREADY_RESOLVED', 'NOT_FOUND')) {
            setClosedElsewhere(true);
            void invalidateProblems(queryClient);
          }
        },
      },
    );
  };

  return (
    <Modal
      open
      size="sm"
      title={t('sort.title', { no: problem.order.shortCode })}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      footer={
        closedElsewhere ? (
          <Button ref={closeRef} variant="primary" onClick={onClose}>
            {t('common:actions.close')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t('common:actions.goBack')}
            </Button>
            <Button variant="primary" loading={busy} onClick={confirm}>
              {t('sort.confirm')}
            </Button>
          </>
        )
      }
    >
      <div className="sf-problems__dialog">
        {closedElsewhere ? null : (
          <Field
            label={t('sort.note')}
            error={pressed && tooShort ? t('validation:NOTE_REQUIRED', { min: NOTE_MIN }) : null}
          >
            <Textarea
              ref={noteRef}
              value={note}
              rows={3}
              maxLength={NOTE_MAX}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        )}
        {error ? (
          <InlineAlert tone={closedElsewhere ? 'warning' : 'danger'} live>
            {error}
          </InlineAlert>
        ) : null}
      </div>
    </Modal>
  );
}
