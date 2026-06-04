import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/auth';

/**
 * Sign the user out after `idleMs` of zero user interaction.
 * Any mouse, keyboard, touch, scroll, or visibility activity resets
 * the timer. Default: 10 minutes.
 *
 * Tab-visibility: switching to another tab doesn't count as idle —
 * we restart the clock on visibilitychange so a quick tab-switch
 * doesn't kick the user out.
 */
export function useIdleLogout(idleMs = 10 * 60 * 1000) {
  const { token, clear } = useAuthStore();
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!token) return;

    const reset = () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        clear();
        // Tiny toast via alert; could be replaced with a nicer banner later.
        window.alert('You have been signed out due to 10 minutes of inactivity.');
      }, idleMs);
    };

    // Events that count as user activity. `passive: true` keeps scrolling smooth.
    const windowEvents: (keyof WindowEventMap)[] = [
      'mousedown',
      'mousemove',
      'keydown',
      'touchstart',
      'scroll',
      'wheel',
      'click',
      'focus',
    ];
    for (const e of windowEvents) window.addEventListener(e, reset, { passive: true });
    document.addEventListener('visibilitychange', reset, { passive: true });

    reset();

    return () => {
      for (const e of windowEvents) window.removeEventListener(e, reset);
      document.removeEventListener('visibilitychange', reset);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [token, clear, idleMs]);
}
