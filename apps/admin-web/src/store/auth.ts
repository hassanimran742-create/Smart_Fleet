import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  role: string | null;
  set: (t: { token: string; refreshToken: string; role: string }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      role: null,
      set: (t) => set({ token: t.token, refreshToken: t.refreshToken, role: t.role }),
      clear: () => set({ token: null, refreshToken: null, role: null }),
    }),
    { name: 'smartfleet.admin.auth' },
  ),
);
