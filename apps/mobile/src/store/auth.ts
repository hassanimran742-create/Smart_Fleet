import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface AuthState {
  token: string | null;
  role: string | null;
  loading: boolean;
  init: () => Promise<void>;
  set: (t: { accessToken: string; refreshToken: string; role: string }) => Promise<void>;
  clear: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  loading: true,
  async init() {
    const token = await SecureStore.getItemAsync('accessToken');
    const role = await SecureStore.getItemAsync('role');
    set({ token, role, loading: false });
  },
  async set(t) {
    await SecureStore.setItemAsync('accessToken', t.accessToken);
    await SecureStore.setItemAsync('refreshToken', t.refreshToken);
    await SecureStore.setItemAsync('role', t.role);
    set({ token: t.accessToken, role: t.role });
  },
  async clear() {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    await SecureStore.deleteItemAsync('role');
    set({ token: null, role: null });
  },
}));
