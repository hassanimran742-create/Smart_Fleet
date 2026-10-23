import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PublicAppConfig } from '@smartfleet/shared-types';
import { api } from '../api/client';
import { qk } from '../api/keys';
import { rememberEnvironment, startingEnvironment } from '../app/env';

/**
 * The registry defaults of API_CONTRACT §6, used until `GET /app/config` answers (or if it can't).
 * Every switched-off module stays off, so a failed load never shows a module the pilot has off.
 */
export const DEFAULT_APP_CONFIG: PublicAppConfig = {
  // The build's setting, else the server's answer from an earlier visit (app/env.ts).
  environment: startingEnvironment(),
  training: false,
  minVersion: { driver: '0.0.0', distributor: '0.0.0' },
  support: { phone: null, whatsApp: null, hours: '9am–9pm' },
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

/** Module switches change rarely; a settings save invalidates `qk.appConfig()` straight away. */
const APP_CONFIG_STALE_MS = 5 * 60_000;

export interface AppConfigState {
  config: PublicAppConfig;
  /** True until the first answer (or failure); modules should not flash "switched off" meanwhile. */
  isLoading: boolean;
  /** True when the defaults are shown because the server couldn't be read. */
  isFallback: boolean;
}

/** `GET /app/config` (public): switched-off modules, the environment and the public limits. */
export function useAppConfig(): AppConfigState {
  const query = useQuery({
    queryKey: qk.appConfig(),
    queryFn: async ({ signal }) => (await api.get<PublicAppConfig>('/app/config', { signal })).data,
    staleTime: APP_CONFIG_STALE_MS,
    refetchOnWindowFocus: true,
  });
  const environment = query.data?.environment;
  useEffect(() => {
    if (environment) rememberEnvironment(environment);
  }, [environment]);
  // An older API may leave out newer keys: fill them from the defaults instead of breaking.
  const config: PublicAppConfig = query.data
    ? {
        ...DEFAULT_APP_CONFIG,
        ...query.data,
        features: { ...DEFAULT_APP_CONFIG.features, ...query.data.features },
      }
    : DEFAULT_APP_CONFIG;
  return { config, isLoading: query.isPending, isFallback: !query.data };
}
