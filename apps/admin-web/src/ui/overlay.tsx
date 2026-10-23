import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * Shared plumbing for Modal, Drawer, ConfirmDialog and the menu overlay (UX_ADMIN §1.8): focus moves
 * into the overlay and back out when it closes, Tab stays inside, Esc closes only the top overlay, and
 * the page behind doesn't scroll.
 */

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0,
  );
}

/**
 * Open overlays, innermost last. The last one handles Esc; the last one that traps focus handles Tab
 * (an escape-only layer, such as an open SearchSelect list, leaves Tab to the dialog around it).
 */
const stack: { id: symbol; escapeOnly: boolean }[] = [];

function topTrap(): symbol | undefined {
  for (let i = stack.length - 1; i >= 0; i -= 1) if (!stack[i].escapeOnly) return stack[i].id;
  return undefined;
}

let scrollLocks = 0;
let savedOverflow = '';

function lockScroll(): void {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

export interface OverlayOptions {
  /** Called on Esc when this is the top overlay. */
  onEscape?: () => void;
  /** What gets focus on open; otherwise the first focusable element, else the container. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Default true. */
  lockScroll?: boolean;
  /**
   * Only take part in Esc (a list that pops out of a box, such as SearchSelect's): no focus moves, no
   * focus trap, no focus restore. Esc then closes this layer, not the drawer or dialog around it.
   */
  escapeOnly?: boolean;
}

/** Traps focus in `containerRef` while `active`, and restores it to where it was on close. */
export function useOverlay(containerRef: RefObject<HTMLElement | null>, active: boolean, options: OverlayOptions = {}): void {
  const onEscapeRef = useRef(options.onEscape);
  onEscapeRef.current = options.onEscape;
  const initialFocusRef = options.initialFocusRef;
  const escapeOnly = options.escapeOnly ?? false;
  const shouldLockScroll = !escapeOnly && (options.lockScroll ?? true);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const id = Symbol('overlay');
    stack.push({ id, escapeOnly });
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const isTop = () => stack[stack.length - 1]?.id === id;
    const isTopTrap = () => topTrap() === id;

    const focusFirst = () => {
      const target = initialFocusRef?.current ?? focusableIn(container)[0] ?? container;
      target.focus({ preventScroll: true });
    };
    if (!escapeOnly) focusFirst();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!isTop()) return;
        if (onEscapeRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeRef.current();
        }
        return;
      }
      if (event.key !== 'Tab' || escapeOnly || !isTopTrap()) return;
      const items = focusableIn(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      // The focus can rest on the overlay itself (a drawer opens focused on itself, not on ×).
      if (current === container) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !container.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (escapeOnly || !isTopTrap()) return;
      const target = event.target;
      if (target instanceof Node && !container.contains(target)) focusFirst();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    if (shouldLockScroll) lockScroll();

    return () => {
      const index = stack.findIndex((entry) => entry.id === id);
      if (index >= 0) stack.splice(index, 1);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      if (shouldLockScroll) unlockScroll();
      if (!escapeOnly && previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
    // Set up once per opening: the callbacks are read through refs, so they may change freely.
  }, [active, containerRef, initialFocusRef, shouldLockScroll, escapeOnly]);
}

/** Renders children at the end of `<body>`, above the page. */
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
