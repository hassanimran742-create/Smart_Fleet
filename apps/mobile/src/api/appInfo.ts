import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import type { AppEnvironment } from '@smartfleet/shared-types';

/** The two builds of this codebase (apps/mobile/app.config.ts `APP_VARIANT`). */
export type MobileVariant = 'distributor' | 'driver';

/** Chosen once per build. Sent as `X-App-Variant` (API_CONTRACT §1.2). */
export const APP_VARIANT: MobileVariant =
  Constants.expoConfig?.extra?.variant === 'driver' ? 'driver' : 'distributor';

export const IS_DRIVER_APP = APP_VARIANT === 'driver';

/** The native app version ("0.1.0"). Over-the-air updates keep it. Sent as `X-App-Version`. */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:3000/api/v1';

/** The over-the-air update running now, for the Help screen; null in development builds. */
export function currentUpdateId(): string | null {
  return Updates.updateId ?? null;
}

const ENVIRONMENTS: readonly AppEnvironment[] = ['development', 'test', 'staging', 'training', 'production'];

/**
 * The build's environment from `EXPO_PUBLIC_ENV` (eas.json). It is only the fallback for the
 * training banner: `GET /app/config` says which server this is. A bundle built without the variable
 * (for example an `eas update` run without the profile's env) counts as production, so real phones
 * never show a test banner by mistake.
 */
export const BUILD_ENVIRONMENT: AppEnvironment = parseEnvironment(process.env.EXPO_PUBLIC_ENV);

function parseEnvironment(value: string | undefined): AppEnvironment {
  const found = ENVIRONMENTS.find((env) => env === value);
  return found ?? 'production';
}

/** Compares two "x.y.z" versions numerically: negative when `a` is older than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** True when `version` is below `minimum`. A malformed minimum never blocks the app. */
export function isVersionBelow(version: string, minimum: string | null | undefined): boolean {
  if (!minimum || !/^\d+(\.\d+){0,2}$/.test(minimum.trim())) return false;
  return compareVersions(version, minimum) < 0;
}

function parseVersion(text: string): [number, number, number] {
  const parts = text.trim().split('.').map((part) => Number.parseInt(part, 10));
  const at = (i: number) => (Number.isFinite(parts[i]) ? parts[i] : 0);
  return [at(0), at(1), at(2)];
}
