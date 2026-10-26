import i18n from '../i18n';
import { useAuthStore } from '../store/auth';
import { showToast } from '../store/toast';
import { clearAccountData } from './queryClient';

let ending: Promise<void> | null = null;

/** Clean-ups that need the session still working, run before a sign-out (the driver's push token). */
const beforeSignOut = new Set<() => Promise<void>>();
/** The longest a sign-out waits for them: it never blocks on a weak signal. */
const BEFORE_SIGN_OUT_MS = 3_000;

/**
 * Registers a best-effort task that runs while the person signs out, before the session is forgotten:
 * the driver app removes its push token this way (screens/driver/push.ts, UX_MOBILE §7.2 R8). A failure
 * or a slow answer never stops the sign-out. Returns a function that removes the task again.
 */
export function onBeforeSignOut(task: () => Promise<void>): () => void {
  beforeSignOut.add(task);
  return () => {
    beforeSignOut.delete(task);
  };
}

async function runBeforeSignOut(): Promise<void> {
  if (beforeSignOut.size === 0) return;
  const tasks = Promise.allSettled([...beforeSignOut].map((task) => Promise.resolve().then(task)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, BEFORE_SIGN_OUT_MS);
  });
  await Promise.race([tasks.then(() => undefined), cap]);
  if (timer) clearTimeout(timer);
}

async function end(reason: 'signedOut' | 'expired'): Promise<void> {
  // The in-memory session goes first (RootNavigator shows Sign in); then the cached data of this
  // account, so the next sign-in never shows it.
  await useAuthStore.getState().clear();
  clearAccountData();
  if (reason === 'expired') {
    showToast({ message: i18n.t('auth.session.expired'), tone: 'neutral' });
  }
}

function endOnce(reason: 'signedOut' | 'expired'): Promise<void> {
  if (!ending) {
    ending = end(reason).finally(() => {
      ending = null;
    });
  }
  return ending;
}

/**
 * Signs out on this phone: runs the registered clean-ups (at most 3 seconds, while the session still
 * works), then forgets the tokens and every cached answer.
 */
export async function signOut(): Promise<void> {
  if (!ending) await runBeforeSignOut();
  return endOnce('signedOut');
}

/**
 * Ends a session the server no longer accepts (the refresh failed): signs out and shows the toast
 * "Please sign in again" (UX_MOBILE §3.1).
 */
export function expireSession(): Promise<void> {
  return endOnce('expired');
}
