import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface AuthState {
  token: string | null;
  role: string | null;
  userId: string | null;
  distributorId: string | null;
  driverId: string | null;
  loading: boolean;
  init: () => Promise<void>;
  set: (t: { accessToken: string; refreshToken: string; role: string }) => Promise<void>;
  clear: () => Promise<void>;
}

function decodeJwt(token: string): any {
  try {
    const payload = token.split('.')[1];
    // base64url -> base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  userId: null,
  distributorId: null,
  driverId: null,
  loading: true,
  async init() {
    const token = await SecureStore.getItemAsync('accessToken');
    const role = await SecureStore.getItemAsync('role');
    const claims = token ? decodeJwt(token) : null;
    set({
      token,
      role,
      userId: claims?.sub ?? null,
      distributorId: claims?.distributorId ?? null,
      driverId: claims?.driverId ?? null,
      loading: false,
    });
  },
  async set(t) {
    const claims = decodeJwt(t.accessToken) ?? {};
    await SecureStore.setItemAsync('accessToken', t.accessToken);
    await SecureStore.setItemAsync('refreshToken', t.refreshToken);
    await SecureStore.setItemAsync('role', t.role);
    if (claims.distributorId) await SecureStore.setItemAsync('distributorId', claims.distributorId);
    if (claims.driverId) await SecureStore.setItemAsync('driverId', claims.driverId);
    set({
      token: t.accessToken,
      role: t.role,
      userId: claims.sub ?? null,
      distributorId: claims.distributorId ?? null,
      driverId: claims.driverId ?? null,
    });
  },
  async clear() {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    await SecureStore.deleteItemAsync('role');
    await SecureStore.deleteItemAsync('distributorId');
    await SecureStore.deleteItemAsync('driverId');
    set({ token: null, role: null, userId: null, distributorId: null, driverId: null });
  },
}));
