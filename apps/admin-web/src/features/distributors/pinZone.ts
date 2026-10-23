import type { IdName } from '@smartfleet/shared-types';
import { useZoneAt, type GeoPin } from './api';

/** What the server says about a store pin (`GET /zones/locate`). */
export type PinZone =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'found'; zone: IdName }
  | { status: 'outside' }
  | { status: 'error' };

/** The zone of a pin, read from the server: the website never decides it (UX_ADMIN §2.4). */
export function usePinZone(pin: GeoPin | null): PinZone {
  const query = useZoneAt(pin);
  if (!pin) return { status: 'none' };
  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error' };
  return query.data ? { status: 'found', zone: query.data } : { status: 'outside' };
}
