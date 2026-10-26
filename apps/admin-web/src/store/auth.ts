import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Why the session ended, so the sign-in page can say so (UX_ADMIN §2.10):
 * - `idle`: 30 minutes without activity ("You were signed out after 30 minutes without activity.");
 * - `session-ended`: the refresh token was refused ("Your session ended. Sign in again.");
 * - `signed-out`: the person pressed Sign out.
 */
export type SignOutReason = 'idle' | 'session-ended' | 'signed-out';

export interface SessionTokens {
  token: string;
  refreshToken: string;
  role: string;
}

interface AuthState {
  /** The access token (JWT). */
  token: string | null;
  refreshToken: string | null;
  /** The role from the last sign-in or refresh, for example "SUPER_ADMIN". */
  role: string | null;
  signedOutReason: SignOutReason | null;
  /** Starts a session after a sign-in. Kept with this name for the legacy sign-in screen. */
  set: (t: SessionTokens) => void;
  /** Replaces the tokens after a refresh; the role is kept when the response has none. */
  setTokens: (t: { token: string; refreshToken: string; role?: string | null }) => void;
  /** Ends the session. Every tab follows, because the store is shared through localStorage. */
  clear: (reason?: SignOutReason) => void;
  /** Forgets the sign-out reason once the sign-in page has shown it. */
  clearSignedOutReason: () => void;
}

export const AUTH_STORAGE_KEY = 'smartfleet.admin.auth';

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      role: null,
      signedOutReason: null,
      set: (t) => set({ token: t.token, refreshToken: t.refreshToken, role: t.role, signedOutReason: null }),
      setTokens: (t) =>
        set((s) => ({ token: t.token, refreshToken: t.refreshToken, role: t.role ?? s.role, signedOutReason: null })),
      clear: (reason = 'signed-out') => set({ token: null, refreshToken: null, role: null, signedOutReason: reason }),
      clearSignedOutReason: () => set({ signedOutReason: null }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      partialize: (s) => ({
        token: s.token,
        refreshToken: s.refreshToken,
        role: s.role,
        signedOutReason: s.signedOutReason,
      }),
    },
  ),
);

/** True when the signed-in role may use this website (UX_ADMIN §2.10: SUPER_ADMIN only). */
export function isOfficeRole(role: string | null | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

// Another tab signed in, refreshed the tokens or signed out: follow it, so two tabs never hold different
// refresh tokens (the API revokes the whole chain when an old refresh token is reused).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === AUTH_STORAGE_KEY) void useAuthStore.persist.rehydrate();
  });
}
