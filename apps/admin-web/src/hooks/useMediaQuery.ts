import { useCallback, useSyncExternalStore } from 'react';

/** True while the CSS media query matches, for example `useMediaQuery('(min-width: 1024px)')`. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
  return useSyncExternalStore(subscribe, read, () => false);
}

/** The layout breakpoints of UX_ADMIN §1.3. */
export const BREAKPOINTS = {
  /** The 232 px sidebar and all columns. */
  wide: '(min-width: 1280px)',
  /** The labelled sidebar (200 px below 1280), no top bar; drawers are side panels. */
  laptop: '(min-width: 1024px)',
  /** Tablet: menu button, full-screen drawers. */
  tablet: '(min-width: 768px)',
} as const;
