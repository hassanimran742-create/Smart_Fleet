import { useId, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './Button';
import { cx } from './cx';
import { Portal, useOverlay } from './overlay';
import { useFirstFieldFocus } from './useFirstFieldFocus';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  /** Esc, the close button and a click outside call this (unless `dismissible` is false). */
  onClose: () => void;
  /** 440 px (`sm`), 560 px (`md`) or 640 px (`lg`, a dialog with a list, such as Mark delivered…); a bottom sheet under 768 px. */
  size?: 'sm' | 'md' | 'lg';
  /** A width in px, only for the legacy Modal shim; new screens use `size`. */
  width?: number;
  description?: ReactNode;
  footer?: ReactNode;
  /**
   * What gets focus first. ConfirmDialog passes "Go back"; otherwise it is the first form field (or the
   * one marked `data-autofocus`), else the dialog itself, never ×.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** False while something is saving: Esc and outside clicks are ignored. Default true. */
  dismissible?: boolean;
  role?: 'dialog' | 'alertdialog';
  className?: string;
  children?: ReactNode;
}

/** A dialog (UX_ADMIN §1.5): traps and restores focus, Esc closes, and it is labelled by its title. */
export function Modal({
  open,
  title,
  onClose,
  size = 'md',
  width,
  description,
  footer,
  initialFocusRef,
  dismissible = true,
  role = 'dialog',
  className,
  children,
}: ModalProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useOverlay(ref, open, { onEscape: dismissible ? onClose : undefined, initialFocusRef: initialFocusRef ?? ref });
  useFirstFieldFocus(ref, bodyRef, open && !initialFocusRef);

  if (!open) return null;

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (dismissible && event.target === event.currentTarget) onClose();
  };

  return (
    <Portal>
      <div className="sf-overlay sf-overlay--modal" onMouseDown={onBackdrop}>
        <div
          ref={ref}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cx('sf-modal', `sf-modal--${size}`, className)}
          style={width ? { inlineSize: `min(${width}px, 100%)` } : undefined}
        >
          <div className="sf-modal__header">
            <h2 id={titleId} className="sf-modal__title">
              {title}
            </h2>
            {dismissible ? <IconButton icon={X} label={t('actions.close')} onClick={onClose} tooltip={false} /> : null}
          </div>
          {description ? (
            <p id={descriptionId} className="sf-modal__description">
              {description}
            </p>
          ) : null}
          <div ref={bodyRef} className="sf-modal__body">
            {children}
          </div>
          {footer ? <div className="sf-modal__footer">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}
