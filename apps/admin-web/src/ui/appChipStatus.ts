import type { AppSeenDto, AppStatus } from '@smartfleet/shared-types';

/**
 * Which app chip a Distributors or Drivers row shows (API_CONTRACT §8.5 step 10): the server's `app.status`,
 * or none for an account that can't sign in (suspended or archived: its app no longer matters) or a server
 * from before the chip (no `app`).
 */
export function appChipStatus(app: AppSeenDto | undefined, active: boolean): AppStatus | null {
  if (!active || !app) return null;
  return app.status;
}
