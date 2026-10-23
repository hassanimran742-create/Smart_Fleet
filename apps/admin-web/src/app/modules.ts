import type { PublicAppConfig } from '@smartfleet/shared-types';
import { useAppConfig } from '../hooks/useAppConfig';

/**
 * Modules the owner can switch on and off (`features.*` settings, ADR-04). A module that is off hides
 * its navigation and its routes show "{{module}} is switched off" (UX_ADMIN §1.2, §2.8); the server
 * refuses its writes either way.
 */
export const MODULES = {
  transfers: { feature: 'transfers', labelKey: 'modules.transfers' },
  fuelRefills: { feature: 'fuelRefills', labelKey: 'modules.fuelRefills' },
  accessories: { feature: 'accessories', labelKey: 'modules.accessories' },
  support: { feature: 'support', labelKey: 'modules.support' },
  clientApp: { feature: 'clientApp', labelKey: 'modules.clientApp' },
} as const satisfies Record<string, { feature: keyof PublicAppConfig['features']; labelKey: `modules.${string}` }>;

export type ModuleId = keyof typeof MODULES;

export interface ModuleState {
  enabled: boolean;
  /** True until `/app/config` first answers: don't flash "switched off" meanwhile. */
  loading: boolean;
}

/** Whether a module is on, from `GET /app/config`. Off when the config can't be read. */
export function useModule(id: ModuleId): ModuleState {
  const { config, isLoading } = useAppConfig();
  return { enabled: config.features[MODULES[id].feature] === true, loading: isLoading };
}
