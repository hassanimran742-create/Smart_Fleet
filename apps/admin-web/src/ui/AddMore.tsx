import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Plus, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { cx } from './cx';

const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';

export interface AddMoreProps {
  /** What it opens, without the "+": "Add CNIC or email". "Add more" by default. */
  label?: string;
  /**
   * `add` (default): a "+ Add …" row that shows optional fields in place and stays open once opened.
   * `toggle`: a row that opens and closes, with a chevron, such as "Activity (3)" at the end of a drawer.
   */
  variant?: 'add' | 'toggle';
  /** Open from the start, for example in an edit drawer when any of its fields is already set. */
  defaultOpen?: boolean;
  /** Controlled: the caller keeps the state (the expense types drawer's "+ Add type" with Cancel). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Replaces the Plus icon of `add`, for example Link on "+ Link a top-up or order". */
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}

/**
 * Optional details behind one tap (UX_PRINCIPLES §3, UX_ADMIN §1.8): a ghost button that shows its
 * fields in place, focusing the first one. The `toggle` variant keeps a collapsible section (a drawer's
 * Activity) closed until it is wanted.
 */
export function AddMore({
  label,
  variant = 'add',
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  icon,
  className,
  children,
}: AddMoreProps) {
  const { t } = useTranslation();
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    contentRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  const text = label ?? t('actions.addMore');

  if (variant === 'toggle') {
    return (
      <div className={cx('sf-add-more', 'sf-add-more--toggle', open && 'is-open', className)}>
        <Button
          variant="ghost"
          iconEnd={open ? ChevronUp : ChevronDown}
          aria-expanded={open}
          aria-controls={contentId}
          className="sf-add-more__button"
          onClick={() => setOpen(!open)}
        >
          {text}
        </Button>
        <div id={contentId} ref={contentRef} className="sf-add-more__content" hidden={!open}>
          {open ? children : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cx('sf-add-more', open && 'is-open', className)}>
      {open ? null : (
        <Button
          variant="ghost"
          icon={icon ?? Plus}
          aria-expanded={false}
          aria-controls={contentId}
          className="sf-add-more__button"
          onClick={() => {
            focusOnOpen.current = true;
            setOpen(true);
          }}
        >
          {text}
        </Button>
      )}
      <div id={contentId} ref={contentRef} className="sf-add-more__content" hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  );
}
