import { CircleAlert, RotateCw, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { errorReference, messageFor, toApiError } from '../api/errors';
import { Button } from './Button';
import { CopyButton } from './CopyButton';
import { cx } from './cx';

export interface ErrorStateProps {
  /** What failed; its message is shown (`errors:<CODE>`, then the server's words). */
  error: unknown;
  /** Shows "Try again". */
  onRetry?: () => void;
  retrying?: boolean;
  /** The page's own title, for example "Couldn't load the orders"; "Couldn't load this" by default. */
  title?: string;
  compact?: boolean;
  className?: string;
}

/**
 * A failed load (UX_ADMIN §1.11): the page's title, the cause in plain words and "Try again". A failure
 * never looks like an empty list. "Reference: 7f3a2c" with a copy icon shows only when the server
 * answered with a request ID, never for no connection or a timeout, where it means nothing to support.
 */
export function ErrorState({ error, onRetry, retrying = false, title, compact = false, className }: ErrorStateProps) {
  const { t } = useTranslation();
  const apiError = toApiError(error);
  // Our own X-Request-Id is attached even when nothing came back; only a server answer is worth quoting.
  const reference = apiError.status !== null ? errorReference(apiError) : null;
  const Icon = apiError.isNetwork ? WifiOff : CircleAlert;
  return (
    <div role="alert" className={cx('sf-error-state', compact && 'sf-error-state--compact', className)}>
      <Icon aria-hidden className="sf-error-state__icon" size={compact ? 24 : 32} strokeWidth={1.75} />
      <p className="sf-error-state__title">{title ?? t('error.title')}</p>
      <p className="sf-error-state__message">{messageFor(apiError)}</p>
      {onRetry ? (
        <div className="sf-error-state__actions">
          <Button icon={RotateCw} onClick={onRetry} loading={retrying}>
            {t('actions.tryAgain')}
          </Button>
        </div>
      ) : null}
      {reference ? (
        <p className="sf-error-state__reference">
          <span>{t('error.reference', { id: reference })}</span>
          <CopyButton iconOnly value={apiError.requestId ?? reference} label={t('error.copyReference')} />
        </p>
      ) : null}
    </div>
  );
}
