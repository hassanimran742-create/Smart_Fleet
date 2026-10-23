import i18n from '../i18n';
import { useAuthStore } from '../store/auth';
import { showToast } from '../store/toast';
import { clearAccountData } from './queryClient';

let ending: Promise<void> | null = null;

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

/** Signs out on this phone: forgets the tokens and every cached answer. */
export function signOut(): Promise<void> {
  return endOnce('signedOut');
}

/**
 * Ends a session the server no longer accepts (the refresh failed): signs out and shows the toast
 * "Please sign in again" (UX_MOBILE §3.1).
 */
export function expireSession(): Promise<void> {
  return endOnce('expired');
}
