import { useCallback, useEffect, useMemo } from 'react';
import { Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { create } from 'zustand';
import type { PublicAppConfig } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import { BUILD_ENVIRONMENT } from '../api/appInfo';
import { api } from '../api/client';
import type { ApiError } from '../api/errors';
import { qk, STALE_MS } from '../api/keys';

/**
 * What the app assumes until `GET /app/config` answers (or when an older server has no such route):
 * the API_CONTRACT §6 defaults, with every switched-off module off. Screens can rely on `config`
 * always being complete.
 */
export const DEFAULT_APP_CONFIG: PublicAppConfig = {
  environment: BUILD_ENVIRONMENT,
  training: BUILD_ENVIRONMENT === 'training',
  minVersion: { driver: '0.0.0', distributor: '0.0.0' },
  support: { phone: null, whatsApp: null, hours: null },
  features: {
    autoAssign: false,
    transfers: false,
    fuelRefills: false,
    accessories: false,
    support: false,
    clientApp: false,
    refills: true,
    scanFlow: false,
    confirmations: false,
    dayEnd: false,
    typedCylinderNumber: true,
    languageSwitch: false,
  },
  topup: {
    minPaisa: '50000',
    maxPaisa: '5000000',
    quickAmountsPaisa: ['200000', '500000', '1000000'],
    checkingHours: { from: '09:00', to: '21:00' },
  },
  wallet: { lowBalancePaisa: '100000', capPaisa: null },
  orders: { maxCylindersPerOrder: 30, deliveryStartedAt: 'FIRST_LOAD_SCAN' },
  refill: { maxCylinders: 30 },
  day: { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' },
  links: { updateUrl: null },
};

/** Lays the server's answer over the defaults, so a server missing a newer key never breaks a screen. */
function withDefaults(server: Partial<PublicAppConfig> | null | undefined): PublicAppConfig {
  if (!server || typeof server !== 'object') return DEFAULT_APP_CONFIG;
  const d = DEFAULT_APP_CONFIG;
  return {
    ...d,
    ...server,
    minVersion: { ...d.minVersion, ...server.minVersion },
    support: { ...d.support, ...server.support },
    features: { ...d.features, ...server.features, refills: true, languageSwitch: false },
    topup: {
      ...d.topup,
      ...server.topup,
      checkingHours: { ...d.topup.checkingHours, ...server.topup?.checkingHours },
    },
    wallet: { ...d.wallet, ...server.wallet },
    orders: { ...d.orders, ...server.orders },
    refill: { ...d.refill, ...server.refill },
    day: { ...d.day, ...server.day },
    links: { ...d.links, ...server.links },
  };
}

/** `GET /app/config`: public, so the update gate and the banners work before sign-in. */
export async function fetchAppConfig(): Promise<PublicAppConfig> {
  const { data } = await api.get<PublicAppConfig>('/app/config', { skipAuth: true, skipAuthRefresh: true });
  const config = withDefaults(data);
  void saveSupportContact(config.support);
  return config;
}

// ---- The office contact, kept on the phone ------------------------------------------------------

type SupportContact = PublicAppConfig['support'];

/**
 * Secure-store key of the last `support` block the server sent (phone, WhatsApp, hours). Only these
 * display conveniences are kept: never the company bank account, which must always be fresh.
 */
const SUPPORT_CONTACT_KEY = 'support.contact';

const useSavedContact = create<{ saved: SupportContact | null }>(() => ({ saved: null }));
let savedContactRead: Promise<void> | null = null;

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function parseContact(raw: string | null): SupportContact | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    return { phone: asText(record.phone), whatsApp: asText(record.whatsApp), hours: asText(record.hours) };
  } catch {
    return null;
  }
}

/** Reads the saved contact once per app run. */
function readSavedContact(): Promise<void> {
  if (!savedContactRead) {
    savedContactRead = SecureStore.getItemAsync(SUPPORT_CONTACT_KEY)
      .then((raw) => {
        const saved = parseContact(raw);
        // A server answer that arrived first has already set the newer contact.
        if (saved && !useSavedContact.getState().saved) useSavedContact.setState({ saved });
      })
      .catch(() => undefined);
  }
  return savedContactRead;
}

/** Keeps each good answer's contact (an office that clears its number clears the saved one too). */
async function saveSupportContact(support: SupportContact): Promise<void> {
  const contact: SupportContact = {
    phone: asText(support.phone),
    whatsApp: asText(support.whatsApp),
    hours: asText(support.hours),
  };
  const previous = useSavedContact.getState().saved;
  if (
    previous &&
    previous.phone === contact.phone &&
    previous.whatsApp === contact.whatsApp &&
    previous.hours === contact.hours
  ) {
    return;
  }
  useSavedContact.setState({ saved: contact });
  try {
    await SecureStore.setItemAsync(SUPPORT_CONTACT_KEY, JSON.stringify(contact));
  } catch {
    // Not kept: "Call office" still works while the app is open.
  }
}

export interface AppConfigState {
  /** The server's config, or the defaults until it has loaded. */
  config: PublicAppConfig;
  /** True once the server has answered at least once. */
  isLoaded: boolean;
  query: UseQueryResult<PublicAppConfig, ApiError>;
}

/**
 * The server-driven switches and limits (UX_MOBILE §3.6), cached for 5 minutes. Menus and tiles read
 * `config.features.*`, so each increment switches on per server without a new build.
 */
export function useAppConfig(): AppConfigState {
  const query = useQuery<PublicAppConfig, ApiError>({
    queryKey: qk.appConfig,
    queryFn: fetchAppConfig,
    staleTime: STALE_MS.appConfig,
    gcTime: Infinity,
    // Every Screen reads the config (the training banner): mounting one must not refetch it, even
    // after a failure. It refreshes when stale and the app returns to the foreground or reconnects.
    refetchOnMount: false,
    retryOnMount: false,
  });
  return { config: query.data ?? DEFAULT_APP_CONFIG, isLoaded: query.data !== undefined, query };
}

/** A `tel:` link for a phone number as the office types it ("0300 1234567", "+92 21 …"). */
export function telUrl(phone: string): string {
  return `tel:${normalizePkPhone(phone) ?? phone.replace(/[^\d+]/g, '')}`;
}

/** A WhatsApp chat link (`https://wa.me/923001234567`), or null when the number can't be read. */
export function whatsAppUrl(phone: string): string | null {
  const e164 = normalizePkPhone(phone);
  const digits = (e164 ?? phone).replace(/\D/g, '');
  return digits.length >= 10 ? `https://wa.me/${digits}` : null;
}

export interface OfficeContact {
  phone: string | null;
  whatsApp: string | null;
  hours: string | null;
  /** Opens the dialler with the office number; does nothing when none is set. */
  call: () => void;
  /** Opens WhatsApp with the office; does nothing when none is set. */
  openWhatsApp: () => void;
}

/**
 * The office's contact details from `support.*` settings, for every "Call office" button. Until the
 * server answers (no signal, or the server is down) it uses the contact kept from the last good
 * answer, so "Call office" never disappears exactly when help is needed (driver spec S4).
 */
export function useOfficeContact(): OfficeContact {
  const { config, isLoaded } = useAppConfig();
  const saved = useSavedContact((s) => s.saved);

  useEffect(() => {
    void readSavedContact();
  }, []);

  const { phone, whatsApp, hours } = isLoaded ? config.support : saved ?? config.support;
  const call = useCallback(() => {
    if (phone) void Linking.openURL(telUrl(phone)).catch(() => undefined);
  }, [phone]);
  const openWhatsApp = useCallback(() => {
    const url = whatsApp ? whatsAppUrl(whatsApp) : null;
    if (url) void Linking.openURL(url).catch(() => undefined);
  }, [whatsApp]);
  return useMemo(() => ({ phone, whatsApp, hours, call, openWhatsApp }), [phone, whatsApp, hours, call, openWhatsApp]);
}
