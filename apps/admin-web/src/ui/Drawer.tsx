import { useCallback, useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './Button';
import { useConfirm } from './ConfirmDialog';
import { cx } from './cx';
import { Portal, useOverlay } from './overlay';
import { useFirstFieldFocus } from './useFirstFieldFocus';

export interface DrawerFooter {
  /** The destructive action ("Reject…", "Remove price…", `ghost-danger`) goes at the start. */
  start?: ReactNode;
  /** The other actions, then the one primary, at the end. */
  end?: ReactNode;
}

/** UX_ADMIN §1.5: a drawer footer holds at most 4 buttons; from 5, the least used go into "More". */
export const DRAWER_FOOTER_MAX_BUTTONS = 4;

export interface DrawerProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A status chip next to the title; a read-only drawer shows its state here. */
  chip?: ReactNode;
  /** 480 px (`md`) or 640 px (`lg`); full screen under 1024 px. */
  width?: 'md' | 'lg';
  /** Unsaved changes: closing asks "Discard changes?" first. */
  dirty?: boolean;
  /**
   * The sticky footer: at most 4 buttons in all, which wrap to a second row rather than scroll. There is
   * no Cancel button: × and Esc close the drawer.
   */
  footer?: DrawerFooter;
  /** A notice under the header, for example "Sana approved this at 4:21 pm" when someone else changed it. */
  notice?: ReactNode;
  /** Close it: drawers are routes, so this usually navigates to the parent. */
  onClose: () => void;
  /** False while saving: Esc, the close button and outside clicks are ignored. Default true. */
  dismissible?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * A side panel for one record (UX_ADMIN §1.5). It is a dialog that traps and restores focus. The focus
 * starts on the first form field (or the one marked `data-autofocus`), else on the drawer itself, never
 * on ×. Esc closes it, asking "Discard changes?" when `dirty`. Record drawers are child routes, so a link
 * opens the exact record, a refresh keeps it open and Back closes it.
 */
export function Drawer({
  title,
  subtitle,
  chip,
  width = 'md',
  dirty = false,
  footer,
  notice,
  onClose,
  dismissible = true,
  className,
  children,
}: DrawerProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const titleId = useId();

  const requestClose = useCallback(async () => {
    if (!dismissible) return;
    if (dirty) {
      const { ok } = await confirm({
        title: t('dialog.discardTitle'),
        body: t('dialog.discardBody'),
        tone: 'danger',
        confirmLabel: t('actions.discardChanges'),
        cancelLabel: t('actions.keepEditing'),
      });
      if (!ok) return;
    }
    onClose();
  }, [confirm, dirty, dismissible, onClose, t]);

  useOverlay(ref, true, { onEscape: () => void requestClose(), initialFocusRef: ref });
  useFirstFieldFocus(ref, bodyRef);

  // A reminder for builders, never shown to the office: a fifth button belongs in "More".
  useEffect(() => {
    if (!import.meta.env.DEV || !footerRef.current) return;
    const buttons = footerRef.current.querySelectorAll('button, a[href]').length;
    if (buttons > DRAWER_FOOTER_MAX_BUTTONS) {
      console.warn(`[Drawer] ${buttons} footer buttons: keep at most ${DRAWER_FOOTER_MAX_BUTTONS} (UX_ADMIN §1.5).`);
    }
  });

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) void requestClose();
  };

  return (
    <Portal>
      <div className="sf-overlay sf-overlay--drawer" onMouseDown={onBackdrop}>
        <section
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cx('sf-drawer', `sf-drawer--${width}`, className)}
        >
          <header className="sf-drawer__header">
            <div className="sf-drawer__heading">
              <div className="sf-drawer__title-row">
                <h2 id={titleId} className="sf-drawer__title">
                  {title}
                </h2>
                {chip}
              </div>
              {subtitle ? <p className="sf-drawer__subtitle">{subtitle}</p> : null}
            </div>
            <IconButton
              icon={X}
              label={t('actions.close')}
              onClick={() => void requestClose()}
              disabled={!dismissible}
              tooltip={false}
            />
          </header>
          {notice ? <div className="sf-drawer__notice">{notice}</div> : null}
          <div ref={bodyRef} className="sf-drawer__body">
            {children}
          </div>
          {footer && (footer.start || footer.end) ? (
            <footer ref={footerRef} className="sf-drawer__footer">
              <div className="sf-drawer__footer-start">{footer.start}</div>
              <div className="sf-drawer__footer-end">{footer.end}</div>
            </footer>
          ) : null}
        </section>
      </div>
    </Portal>
  );
}
