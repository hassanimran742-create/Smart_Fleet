import { useEffect, useRef, type RefObject } from 'react';

const FIELDS = [
  'input:not([type="hidden"]):not([disabled]):not([readonly])',
  'select:not([disabled])',
  'textarea:not([disabled]):not([readonly])',
].join(',');

/** How long a dialog keeps waiting for its form to load before it leaves the focus where it is. */
const WAIT_MS = 5000;

function isShown(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && el.closest('[inert], [aria-hidden="true"]') === null;
}

/** The field marked `data-autofocus`, else the first form field that can take the focus. */
function firstField(scope: HTMLElement): HTMLElement | null {
  const marked = scope.querySelector<HTMLElement>('[data-autofocus]');
  if (marked && isShown(marked)) return marked;
  for (const field of Array.from(scope.querySelectorAll<HTMLElement>(FIELDS))) {
    if (isShown(field)) return field;
  }
  return null;
}

/**
 * The first focus of a drawer or dialog (UX_ADMIN §1.5): it opens focused on itself (so the heavy focus
 * ring never sits on ×), then moves to its first form field, or the one marked `data-autofocus`, as soon
 * as that field exists: the form may still be loading when it opens. It stops trying once the person
 * clicks or types inside, or after a few seconds, so it never pulls the focus away from them.
 */
export function useFirstFieldFocus(
  containerRef: RefObject<HTMLElement | null>,
  scopeRef: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  const done = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const scope = scopeRef.current;
    if (!container || !scope) return;
    done.current = false;

    const tryFocus = (): boolean => {
      if (done.current) return true;
      // The focus already went somewhere on purpose (a field, a nested dialog): leave it there.
      if (document.activeElement !== container) return false;
      const field = firstField(scope);
      if (!field) return false;
      field.focus();
      done.current = true;
      return true;
    };

    const stop = () => {
      done.current = true;
    };
    container.addEventListener('pointerdown', stop, true);
    container.addEventListener('keydown', stop, true);

    let observer: MutationObserver | null = null;
    let timer: number | undefined;
    // The overlay focuses the container in its own effect, which runs first; try once that has happened.
    const frame = window.requestAnimationFrame(() => {
      if (tryFocus()) return;
      observer = new MutationObserver(() => {
        if (tryFocus()) observer?.disconnect();
      });
      observer.observe(scope, { childList: true, subtree: true });
      timer = window.setTimeout(() => observer?.disconnect(), WAIT_MS);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer?.disconnect();
      container.removeEventListener('pointerdown', stop, true);
      container.removeEventListener('keydown', stop, true);
    };
  }, [containerRef, scopeRef, enabled]);
}
