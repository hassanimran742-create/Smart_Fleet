import { useId, useRef, useState, type MouseEvent } from 'react';
import { ImageOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cx, IconButton, Portal, Spinner, useOverlay } from '../../ui';

export interface ProofViewerProps {
  /** The signed screenshot URL (valid for 1 hour). */
  url: string;
  distributor: string;
  /**
   * Fetches the request again for a fresh signed URL. Called once when the picture doesn't load (the
   * link may have expired); a second failure shows the message instead.
   */
  onRefresh: () => Promise<string | null>;
  onClose: () => void;
}

/**
 * The payment screenshot (UX_ADMIN §2.2 ProofViewer): it fits the window, and a click zooms to 2×. If the
 * signed link fails, it is fetched again once; then "Can't load the screenshot. Close and open the request
 * again."
 */
export function ProofViewer({ url, distributor, onRefresh, onClose }: ProofViewerProps) {
  const { t } = useTranslation(['topups', 'common']);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [src, setSrc] = useState(url);
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  useOverlay(ref, true, { onEscape: onClose });

  const onError = async () => {
    if (retried) {
      setFailed(true);
      return;
    }
    setRetried(true);
    try {
      const fresh = await onRefresh();
      if (fresh && fresh !== src) setSrc(fresh);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  };

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <Portal>
      <div className="sf-overlay sf-proof" onMouseDown={onBackdrop}>
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="sf-proof__frame">
          <div className="sf-proof__bar">
            <h2 id={titleId} className="sf-proof__title">
              {t('proof.title', { distributor })}
            </h2>
            {!failed && loaded ? <span className="sf-proof__hint">{zoomed ? t('proof.zoomOut') : t('proof.zoomIn')}</span> : null}
            <IconButton icon={X} label={t('common:actions.close')} onClick={onClose} tooltip={false} />
          </div>
          <div className={cx('sf-proof__stage', zoomed && 'is-zoomed')}>
            {failed ? (
              <p className="sf-proof__failed" role="alert">
                <ImageOff aria-hidden size={28} strokeWidth={1.75} />
                <span>{t('proof.failed')}</span>
              </p>
            ) : (
              <>
                {!loaded ? (
                  <span className="sf-proof__loading">
                    <Spinner label={t('proof.loading')} size={24} />
                  </span>
                ) : null}
                <button
                  type="button"
                  className="sf-proof__toggle"
                  aria-pressed={zoomed}
                  aria-label={zoomed ? t('proof.zoomOut') : t('proof.zoomIn')}
                  onClick={() => setZoomed((value) => !value)}
                >
                  <img
                    src={src}
                    alt={t('proof.alt', { distributor })}
                    className={cx('sf-proof__image', !loaded && 'is-hidden')}
                    onLoad={() => setLoaded(true)}
                    onError={() => void onError()}
                  />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
