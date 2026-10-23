import { create } from 'zustand';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  /** How long it stays, in ms; 3 seconds by default (UX_MOBILE §2.2 #18). */
  durationMs?: number;
}

export interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

interface ToastState {
  current: ToastMessage | null;
  show: (input: ToastInput) => void;
  hide: (id?: number) => void;
}

const DEFAULT_DURATION_MS = 3000;
let nextId = 1;

/**
 * The one toast at a time, shown by `ToastHost` (ui/Toast.tsx). A store with no UI, so non-React
 * code (the API client's "Please sign in again") can show one too.
 */
export const useToastStore = create<ToastState>((set, get) => ({
  current: null,
  show: ({ message, tone = 'neutral', durationMs = DEFAULT_DURATION_MS }) =>
    set({ current: { id: nextId++, message, tone, durationMs } }),
  hide: (id) => {
    const current = get().current;
    if (!current || (id !== undefined && current.id !== id)) return;
    set({ current: null });
  },
}));

/** Shows a toast from anywhere. In components prefer `useToast()`. */
export function showToast(input: ToastInput): void {
  useToastStore.getState().show(input);
}
