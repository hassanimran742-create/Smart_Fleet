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
import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../api/errors';
import { cx } from './cx';
import { Portal } from './overlay';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  /** Replaces a toast with the same id instead of stacking a second one. */
  id?: string;
  /** Milliseconds before it closes by itself; null keeps it until closed. */
  durationMs?: number | null;
}

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  durationMs: number | null;
}

export interface ToastApi {
  /** A finished action, 6 words or fewer ("Price saved for Zone East."). Closes after 6 seconds. */
  success: (message: string, options?: ToastOptions) => string;
  /** A failure; an error object is turned into its message. Stays until closed. */
  error: (messageOrError: unknown, options?: ToastOptions) => string;
  /** A notice that stays until closed (or `durationMs`), for example the idle sign-out warning. */
  info: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

/** UX_ADMIN §1.11: a success toast stays 6 seconds (paused while the pointer or focus is on it). */
const SUCCESS_MS = 6000;
const MAX_TOASTS = 4;

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Toasts confirm finished actions; form errors stay inline (UX_ADMIN §1.5). They show at the top centre
 * of the window, clear of drawer footers, with a tick and a close button. They sit in live regions:
 * polite for success and info, assertive for errors.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast needs <ToastProvider> above it');
  return api;
}

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, message: string, options: ToastOptions = {}, fallbackMs: number | null) => {
    const id = options.id ?? `toast-${++toastSeq}`;
    const durationMs = options.durationMs === undefined ? fallbackMs : options.durationMs;
    setToasts((list) => [...list.filter((toast) => toast.id !== id), { id, tone, message, durationMs }].slice(-MAX_TOASTS));
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push('success', message, options, SUCCESS_MS),
      error: (messageOrError, options) =>
        push('error', typeof messageOrError === 'string' ? messageOrError : messageFor(messageOrError), options, null),
      info: (message, options) => push('info', message, options, null),
      dismiss,
    }),
    [push, dismiss],
  );

  const polite = toasts.filter((toast) => toast.tone !== 'error');
  const urgent = toasts.filter((toast) => toast.tone === 'error');

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Portal>
        <div className="sf-toasts">
          <ToastRegion politeness="polite" toasts={polite} onDismiss={dismiss} />
          <ToastRegion politeness="assertive" toasts={urgent} onDismiss={dismiss} />
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

const TONE_ICONS: Record<ToastTone, LucideIcon> = { success: CircleCheck, error: CircleAlert, info: Info };

function ToastRegion({
  politeness,
  toasts,
  onDismiss,
}: {
  politeness: 'polite' | 'assertive';
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="sf-toasts__region"
      aria-label={t('toast.region')}
      {...(politeness === 'assertive' ? { role: 'alert' } : { role: 'status' })}
      aria-live={politeness}
    >
      {toasts.map((toast) => (
        <ToastView key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </section>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (remaining.current === null || paused) return;
    startedAt.current = Date.now();
    const id = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(id);
      if (remaining.current !== null) remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, toast.id, onDismiss]);

  const Icon = TONE_ICONS[toast.tone];
  return (
    <div
      className={cx('sf-toast', `sf-toast--${toast.tone}`)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon aria-hidden className="sf-toast__icon" size={18} strokeWidth={2} />
      <p className="sf-toast__message">{toast.message}</p>
      <button type="button" className="sf-toast__close" aria-label={t('toast.dismiss')} onClick={() => onDismiss(toast.id)}>
        <X aria-hidden size={16} />
      </button>
    </div>
  );
}
