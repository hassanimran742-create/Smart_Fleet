import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/auth';
import { useToast } from '../ui/Toast';

/** UX_ADMIN §2.10: sign out after 30 minutes without activity, with a warning 2 minutes before. */
export const IDLE_SIGN_OUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 2 * 60 * 1000;

/** The last activity in any tab, so a quiet tab doesn't sign out someone working in another one. */
const ACTIVITY_KEY = 'smartfleet.admin.lastActivity';
const SHARE_EVERY_MS = 5000;
const WARNING_TOAST_ID = 'idle-sign-out-warning';

function readShared(): number {
  try {
    const value = Number(window.localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeShared(at: number): void {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Storage unavailable: this tab still counts its own activity.
  }
}

/**
 * Signs the office out after `idleMs` without activity (mouse, keyboard, touch, scroll or coming back
 * to the tab), in any open tab. A toast warns `warnMs` before; any activity dismisses it. The sign-in
 * page then says "You were signed out after 30 minutes without activity."
 */
export function useIdleLogout(idleMs: number = IDLE_SIGN_OUT_MS, warnMs: number = IDLE_WARNING_MS): void {
  // Signed in or not, never the token itself: a silent refresh (which background polling can trigger)
  // must not restart the idle clock.
  const signedIn = useAuthStore((s) => s.token !== null);
  const toast = useToast();
  const { t } = useTranslation();
  const warningText = t('session.idleWarning');

  useEffect(() => {
    if (!signedIn) return;
    let lastLocal = Date.now();
    let lastShared = 0;
    let warning = false;
    let warnTimer: number | undefined;
    let outTimer: number | undefined;

    const lastActivity = () => Math.max(lastLocal, readShared());

    const clearTimers = () => {
      window.clearTimeout(warnTimer);
      window.clearTimeout(outTimer);
    };

    const hideWarning = () => {
      if (!warning) return;
      warning = false;
      toast.dismiss(WARNING_TOAST_ID);
    };

    const schedule = () => {
      clearTimers();
      const since = Date.now() - lastActivity();
      if (since >= idleMs) {
        hideWarning();
        useAuthStore.getState().clear('idle');
        return;
      }
      warnTimer = window.setTimeout(onWarnTime, Math.max(0, idleMs - warnMs - since));
      outTimer = window.setTimeout(schedule, idleMs - since);
    };

    function onWarnTime() {
      // Another tab may have been used meanwhile: then just wait again.
      if (Date.now() - lastActivity() < idleMs - warnMs) {
        schedule();
        return;
      }
      warning = true;
      toast.info(warningText, { id: WARNING_TOAST_ID, durationMs: null });
    }

    const onActivity = () => {
      lastLocal = Date.now();
      if (lastLocal - lastShared >= SHARE_EVERY_MS) {
        lastShared = lastLocal;
        writeShared(lastLocal);
      }
      if (warning) {
        hideWarning();
        schedule();
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === ACTIVITY_KEY && warning) {
        hideWarning();
        schedule();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') onActivity();
    };

    const events: (keyof WindowEventMap)[] = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel', 'focus'];
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    writeShared(lastLocal);
    schedule();

    return () => {
      clearTimers();
      hideWarning();
      for (const name of events) window.removeEventListener(name, onActivity);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [signedIn, idleMs, warnMs, toast, warningText]);
}
