import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../api/errors';
import { translateDynamic } from '../i18n';
import { Button } from './Button';
import { Field, Textarea } from './Field';
import { InlineAlert } from './InlineAlert';
import { KeyValueList, type KeyValueItem } from './KeyValueList';
import { Modal } from './Modal';
import { RadioCards } from './RadioCards';

export interface ConfirmReasonOption {
  value: string;
  label: string;
  description?: string;
}

export interface ConfirmReason {
  /** The note's label; "Note" by default, "Why?" when there are no options (UX_ADMIN §1.6). */
  label?: string;
  hint?: string;
  /** Whether a note is required (always, or only for the codes in `requiredFor`). */
  required?: boolean;
  /** Shortest note, in characters (trimmed). */
  minLength?: number;
  maxLength?: number;
  /** Reason codes to pick from (a pick is then required), for example the cancel reasons. */
  options?: readonly ConfirmReasonOption[];
  /** The option label above the choices; "Reason" by default. */
  optionsLabel?: string;
  /** The choices in 1 or 2 columns (2 keeps a dialog of 4–6 reasons short); 1 by default. */
  optionColumns?: 1 | 2;
  /** Codes that need a note even when `required` is false; `OTHER` needs one (API_CONTRACT §1.5). */
  requiredFor?: readonly string[];
  /**
   * Show the note only once one of these codes is picked (Remove expense: "Other" opens "Why?"); the
   * note shows from the start when this is left out.
   */
  noteFor?: readonly string[];
}

export interface ConfirmOptions {
  /** 6 words or fewer: the verb and the thing ("Suspend Ahmed Gas?"). */
  title: string;
  /** Facts the person checks before saying yes (reference, amounts, time). */
  facts?: readonly KeyValueItem[];
  /** A few short facts as a bulleted list, instead of a long body (Suspend: what stops, what stays). */
  points?: readonly ReactNode[];
  /** 12 words or fewer, after the facts. */
  body?: ReactNode;
  /** `danger` for anything that can't be undone or loses money. */
  tone?: 'default' | 'warning' | 'danger';
  /** A verb plus the amount or object: "Yes, add Rs 5,000". */
  confirmLabel: string;
  /** "Go back" by default; it has the focus when the dialog opens. */
  cancelLabel?: string;
  reason?: ConfirmReason;
  /**
   * Runs on confirm while the dialog stays open with a spinner; an error is shown inside the dialog and
   * the person can try again or go back. The dialog closes when it resolves.
   */
  action?: (input: { reason?: string; reasonCode?: string }) => Promise<unknown>;
}

export interface ConfirmResult {
  ok: boolean;
  /** The note, trimmed. */
  reason?: string;
  /** The picked reason code. */
  reasonCode?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** For code outside React (the legacy Modal shim): the provider registers itself here. */
let globalConfirm: ConfirmFn | null = null;

/** Opens the app's ConfirmDialog from anywhere. Resolves `{ ok: false }` if no provider is mounted. */
export function confirmOutsideReact(options: ConfirmOptions): Promise<ConfirmResult> {
  return globalConfirm ? globalConfirm(options) : Promise.resolve({ ok: false });
}

/**
 * `const confirm = useConfirm(); const { ok, reason } = await confirm({...})` (UX_ADMIN §1.5). It replaces
 * every `window.confirm` and `window.prompt`.
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm needs <ConfirmProvider> above it');
  return confirm;
}

interface Pending {
  id: number;
  options: ConfirmOptions;
  resolve: (result: ConfirmResult) => void;
}

let nextPendingId = 0;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<ConfirmResult>((resolve) => {
      // One question at a time: a new one answers the old one with "no".
      pendingRef.current?.resolve({ ok: false });
      const next = { id: ++nextPendingId, options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  useEffect(() => {
    globalConfirm = confirm;
    return () => {
      if (globalConfirm === confirm) globalConfirm = null;
    };
  }, [confirm]);

  const finish = useCallback((result: ConfirmResult) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(result);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? <ConfirmDialog key={pending.id} options={pending.options} onFinish={finish} /> : null}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ options, onFinish }: { options: ConfirmOptions; onFinish: (r: ConfirmResult) => void }) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { reason } = options;
  const [note, setNote] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const trimmed = note.trim();
  const showNote = Boolean(reason && (!reason.noteFor || (code !== null && reason.noteFor.includes(code))));
  const needsNote =
    showNote && Boolean(reason && (reason.required || (code !== null && reason.requiredFor?.includes(code))));
  const minLength = reason?.minLength ?? (needsNote ? 3 : 0);

  const optionError = reason?.options && code === null ? t('dialog.pickReason') : null;
  const noteError = useMemo(() => {
    if (!reason || !showNote) return null;
    if (needsNote && trimmed.length === 0) return translateDynamic('validation:NOTE_REQUIRED', { min: Math.max(minLength, 1) });
    if (trimmed.length > 0 && trimmed.length < minLength) return translateDynamic('validation:TOO_SHORT', { min: minLength });
    return null;
  }, [reason, showNote, needsNote, trimmed, minLength]);

  const cancel = () => {
    if (!busy) onFinish({ ok: false });
  };

  const submit = async () => {
    if (optionError || noteError) {
      setShowErrors(true);
      return;
    }
    const input = { reason: (showNote && trimmed) || undefined, reasonCode: code ?? undefined };
    if (!options.action) {
      onFinish({ ok: true, ...input });
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await options.action(input);
      onFinish({ ok: true, ...input });
    } catch (error) {
      setActionError(messageFor(error));
      setBusy(false);
    }
  };

  const tone = options.tone ?? 'default';
  return (
    <Modal
      open
      role="alertdialog"
      size={reason?.options ? 'md' : 'sm'}
      title={options.title}
      onClose={cancel}
      dismissible={!busy}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={cancel} disabled={busy}>
            {options.cancelLabel ?? t('actions.goBack')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={() => void submit()}>
            {options.confirmLabel}
          </Button>
        </>
      }
    >
      {options.facts && options.facts.length > 0 ? <KeyValueList items={options.facts} /> : null}
      {options.points && options.points.length > 0 ? (
        <ul className="sf-confirm__points">
          {options.points.map((point, index) => (
            <li key={index} className="sf-confirm__point">
              {point}
            </li>
          ))}
        </ul>
      ) : null}
      {options.body ? <div className="sf-confirm__body">{options.body}</div> : null}
      {reason?.options ? (
        <Field label={reason.optionsLabel ?? t('dialog.reason')} error={showErrors ? optionError : null}>
          <RadioCards
            options={reason.options.map((o) => ({ value: o.value, label: o.label, description: o.description }))}
            value={code}
            onChange={setCode}
            columns={reason.optionColumns ?? 1}
          />
        </Field>
      ) : null}
      {reason && showNote ? (
        <Field
          label={reason.label ?? (reason.options ? t('dialog.note') : t('dialog.why'))}
          hint={reason.hint}
          optional={!needsNote}
          error={showErrors ? noteError : null}
        >
          <Textarea value={note} maxLength={reason.maxLength ?? 300} onChange={(e) => setNote(e.target.value)} />
        </Field>
      ) : null}
      {actionError ? (
        <InlineAlert tone="danger" live>
          {actionError}
        </InlineAlert>
      ) : null}
    </Modal>
  );
}
