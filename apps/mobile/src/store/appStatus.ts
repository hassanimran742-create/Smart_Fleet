import { useEffect, useState } from 'react';
import { create } from 'zustand';

/** How long the offline banner stays after the last network error (UX_MOBILE §2.2 #23, Inc 1). */
export const OFFLINE_BANNER_MS = 30_000;

interface AppStatusState {
  /** When a request last failed with no response; null once a request gets through again. */
  lastNetworkErrorAt: number | null;
  /** Set by a 426 `APP_UPDATE_REQUIRED` reply: RootNavigator then shows the update gate. */
  updateRequired: boolean;
  markNetworkError: () => void;
  markNetworkOk: () => void;
  markUpdateRequired: () => void;
}

/**
 * App-wide status the API client reports and the shell reads: connectivity (until the 0.2.0 APK
 * brings NetInfo) and the update gate.
 */
export const useAppStatusStore = create<AppStatusState>((set, get) => ({
  lastNetworkErrorAt: null,
  updateRequired: false,
  markNetworkError: () => set({ lastNetworkErrorAt: Date.now() }),
  markNetworkOk: () => {
    if (get().lastNetworkErrorAt !== null) set({ lastNetworkErrorAt: null });
  },
  markUpdateRequired: () => {
    if (!get().updateRequired) set({ updateRequired: true });
  },
}));

/**
 * True while the "No connection" banner shows: for 30 seconds after a request got no answer, until
 * one gets through. Screens use it to add no network error of their own while the banner is up
 * (UX_PRINCIPLES rule 8), and to offer their own "Try again" once it has gone.
 */
export function useNoConnection(): boolean {
  const lastErrorAt = useAppStatusStore((s) => s.lastNetworkErrorAt);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (lastErrorAt === null) return;
    const left = OFFLINE_BANNER_MS - (Date.now() - lastErrorAt);
    if (left <= 0) return;
    // Re-render once the banner's time is up, so it hides without another request.
    const timer = setTimeout(() => setTick((n) => n + 1), left + 50);
    return () => clearTimeout(timer);
  }, [lastErrorAt]);

  return lastErrorAt !== null && Date.now() - lastErrorAt < OFFLINE_BANNER_MS;
}
