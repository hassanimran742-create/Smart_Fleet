import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { UserRoleValue } from '@smartfleet/shared-types';

/** Secure-store keys. The profile ids are kept under the names the 0.1.0 app used. */
const KEYS = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  role: 'role',
  distributorId: 'distributorId',
  driverId: 'driverId',
  clientId: 'clientId',
} as const;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** The role the server returned; the token's `role` claim is used when it is missing. */
  role?: string | null;
}

interface AuthState {
  token: string | null;
  role: UserRoleValue | null;
  userId: string | null;
  distributorId: string | null;
  driverId: string | null;
  /** @deprecated Customer login is off for the pilot (ADR-03); kept for the retired client screens. */
  clientId: string | null;
  /** True until the saved session has been read at boot. */
  loading: boolean;
  /** Reads the saved session (call once at boot). */
  init: () => Promise<void>;
  /** Saves a session from `POST /auth/login` or `POST /auth/refresh`. */
  set: (tokens: SessionTokens) => Promise<void>;
  /** Forgets the session on this phone. Use `signOut()` from api/session.ts, which also clears cached data. */
  clear: () => Promise<void>;
}

interface Claims {
  sub?: string;
  role?: string;
  distributorId?: string | null;
  driverId?: string | null;
  clientId?: string | null;
  exp?: number;
}

const ROLES: readonly UserRoleValue[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'DISPATCHER',
  'STORE_KEEPER',
  'DISTRIBUTOR',
  'DRIVER',
  'CLIENT',
];

function asRole(value: unknown): UserRoleValue | null {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value) ? (value as UserRoleValue) : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes base64 without relying on `atob` (not every Hermes build has it). */
function base64Decode(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const char of clean) {
    // Only the low 14 bits are ever read, so keep the accumulator small.
    value = ((value << 6) | B64.indexOf(char)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  try {
    // The bytes are UTF-8; decode multi-byte characters.
    return decodeURIComponent(
      out
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
  } catch {
    return out;
  }
}

/** Reads a JWT's claims without verifying it (the server verifies; the phone only routes). */
export function decodeJwt(token: string): Claims | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = base64Decode(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims: unknown = JSON.parse(json);
    return claims && typeof claims === 'object' ? (claims as Claims) : null;
  } catch {
    return null;
  }
}

async function writeOrDelete(key: string, value: string | null | undefined): Promise<void> {
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

async function safeRead(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

/** The saved refresh token, read when the access token must be renewed (api/client.ts). */
export function getRefreshToken(): Promise<string | null> {
  return safeRead(KEYS.refreshToken);
}

/**
 * The number of the last good sign-in on this phone (E.164), so Sign in can prefill it. It isn't part
 * of the session: signing out keeps it, because getting back in still needs the password.
 */
const LAST_PHONE_KEY = 'auth.lastPhone';

export function readLastPhone(): Promise<string | null> {
  return safeRead(LAST_PHONE_KEY);
}

export async function saveLastPhone(e164: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAST_PHONE_KEY, e164);
  } catch {
    // Not saved: Sign in just starts empty next time.
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  userId: null,
  distributorId: null,
  driverId: null,
  clientId: null,
  loading: true,

  async init() {
    const token = await safeRead(KEYS.accessToken);
    const savedRole = await safeRead(KEYS.role);
    const claims = token ? decodeJwt(token) : null;
    set({
      token,
      role: token ? asRole(claims?.role) ?? asRole(savedRole) : null,
      userId: claims?.sub ?? null,
      distributorId: claims?.distributorId ?? null,
      driverId: claims?.driverId ?? null,
      clientId: claims?.clientId ?? null,
      loading: false,
    });
  },

  async set(tokens) {
    const claims = decodeJwt(tokens.accessToken) ?? {};
    const role = asRole(tokens.role) ?? asRole(claims.role);
    await SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken);
    await SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken);
    await writeOrDelete(KEYS.role, role);
    // Always rewrite the profile ids, so a previous account's ids never survive a new sign-in.
    await writeOrDelete(KEYS.distributorId, claims.distributorId);
    await writeOrDelete(KEYS.driverId, claims.driverId);
    await writeOrDelete(KEYS.clientId, claims.clientId);
    set({
      token: tokens.accessToken,
      role,
      userId: claims.sub ?? null,
      distributorId: claims.distributorId ?? null,
      driverId: claims.driverId ?? null,
      clientId: claims.clientId ?? null,
      loading: false,
    });
  },

  async clear() {
    // Drop the in-memory session first, so no request goes out with it while storage is cleared.
    set({ token: null, role: null, userId: null, distributorId: null, driverId: null, clientId: null, loading: false });
    await Promise.all(
      Object.values(KEYS).map((key) => SecureStore.deleteItemAsync(key).catch(() => undefined)),
    );
  },
}));
