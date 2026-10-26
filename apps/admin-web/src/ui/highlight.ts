import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * The one visual addition of the UX pass (UX_ADMIN §1.3, §1.11): after an action, the changed row or
 * card gets a static `--primary-soft` tint for 2 seconds, then loses it. No movement, so nothing to turn
 * off under reduced motion. Tables take the key as `highlightKey`; a card adds the `sf-highlight` class.
 */
export const HIGHLIGHT_MS = 2000;

interface Flash {
  key: string;
  seq: number;
}

const flashes = new Map<string, Flash>();
const listeners = new Set<() => void>();
let flashSeq = 0;

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Marks a record as just changed, for a list rendered elsewhere: a drawer saves a price and calls
 * `flashRow('prices', zoneId)`; the page passes `useFlashedRow('prices')` to its Table. The tint ends by
 * itself after 2 seconds; flashing again restarts it.
 */
export function flashRow(scope: string, key: string, ms: number = HIGHLIGHT_MS): void {
  const seq = ++flashSeq;
  flashes.set(scope, { key, seq });
  emit();
  window.setTimeout(() => {
    if (flashes.get(scope)?.seq !== seq) return;
    flashes.delete(scope);
    emit();
  }, ms);
}

/** The key flashed in `scope` while its tint lasts, else null. */
export function useFlashedRow(scope: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => flashes.get(scope)?.key ?? null,
    () => null,
  );
}

/**
 * The same tint for something on this screen: `const [key, highlight] = useHighlight()`, then
 * `highlight(row.id)` after the action and `<Table highlightKey={key} />` (or `key === 'balance'` for a
 * card's `sf-highlight` class).
 */
export function useHighlight(ms: number = HIGHLIGHT_MS): [string | null, (key: string) => void] {
  const [key, setKey] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const highlight = useCallback(
    (next: string) => {
      window.clearTimeout(timer.current);
      setKey(next);
      timer.current = window.setTimeout(() => setKey(null), ms);
    },
    [ms],
  );
  return [key, highlight];
}
