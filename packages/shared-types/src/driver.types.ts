import type { GeoPoint, IsoDateTime, ISODateString, UUID } from './common.types';
import type { UserStatusValue } from './user.types';

export interface Driver {
  id: UUID;
  userId: UUID;
  licenceNo: string;
  currentVehicleId?: UUID;
  currentZoneId?: UUID;
  currentLocation?: GeoPoint;
  currentLocationUpdatedAt?: ISODateString;
  isOnline: boolean;
}

/** Mirrors Prisma `DriverAvailability`. Only AVAILABLE can be assigned (API_CONTRACT §7.6 rule 2). */
export const DriverAvailability = {
  AVAILABLE: 'AVAILABLE',
  ON_LEAVE: 'ON_LEAVE',
  OFF_DUTY: 'OFF_DUTY',
} as const;
export type DriverAvailability = (typeof DriverAvailability)[keyof typeof DriverAvailability];

/**
 * The office driver view (API_CONTRACT §7.2, §3.5): `GET /drivers`, `GET /drivers/:id` as the office,
 * `POST /drivers` and `PATCH /drivers/:id/profile`. Safe fields only: never the password hash or the
 * CNIC, only `cnicMasked` ("*****-****567-1", null when none is stored). A driver reading themselves
 * gets the same shape without `cnicMasked`. The last known position feeds the office map and the
 * live-tracking dialog.
 */
export interface DriverOfficeDto {
  id: UUID;
  userId: UUID;
  licenceNo: string;
  availability: DriverAvailability;
  isOnline: boolean;
  currentVehicleId: UUID | null;
  currentZoneId: UUID | null;
  leaveStart: IsoDateTime | null;
  leaveEnd: IsoDateTime | null;
  user: {
    id: UUID;
    name: string;
    phone: string;
    email: string | null;
    status: UserStatusValue;
    profilePictureUrl: string | null;
  };
  currentVehicle: { id: UUID; plateNo: string } | null;
  /** The last position the driver's app reported (`PATCH /drivers/:id/location`, the socket), or null. */
  currentLocation: { lat: number; lng: number } | null;
  currentLocationUpdatedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  /** Office views only. */
  cnicMasked?: string | null;
}
