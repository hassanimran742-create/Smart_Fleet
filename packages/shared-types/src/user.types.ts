import type { IsoDateTime, ISODateString, UUID } from './common.types';
import type { DistributorStatus } from './distributor.types';
import type { DriverAvailability } from './driver.types';
import type { VehicleStatus } from './vehicle.types';

/** Mirrors Prisma `UserRole`. The office is SUPER_ADMIN; the other staff roles are locked for the pilot (ADR-02). */
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  DISPATCHER = 'DISPATCHER',
  STORE_KEEPER = 'STORE_KEEPER',
  DISTRIBUTOR = 'DISTRIBUTOR',
  DRIVER = 'DRIVER',
  CLIENT = 'CLIENT',
}

/** The wire value of a {@link UserRole}. A string union, so Prisma's enum values are assignable to it. */
export type UserRoleValue = `${UserRole}`;

export enum UserStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

/** The wire value of a {@link UserStatus}. */
export type UserStatusValue = `${UserStatus}`;

export interface User {
  id: UUID;
  phone: string;
  email?: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: ISODateString;
}

/** A DISTRIBUTOR's shop part of {@link SafeUserDto} (its `distributors` row); null for other roles. */
export interface SafeUserDistributorProfile {
  id: UUID;
  businessName: string;
  /** The shop code ("AG"); null only for a legacy shop not given one yet. */
  code: string | null;
  status: DistributorStatus;
  homeStoreId: UUID | null;
}

/** A DRIVER's driver part of {@link SafeUserDto} (its `drivers` row); null for other roles. */
export interface SafeUserDriverProfile {
  id: UUID;
  licenceNo: string;
  availability: DriverAvailability;
  isOnline: boolean;
  currentVehicleId: UUID | null;
  currentVehicle: {
    id: UUID;
    plateNo: string;
    capacityUnits: number;
    status: `${VehicleStatus}`;
    currentOdometerKm: number;
  } | null;
}

/**
 * A user as `GET /users/me`, `PATCH /users/me`, `GET /users` and `GET /users/:id` send it (API_CONTRACT
 * §3.5, §7.2): explicit safe fields only, never the password hash, the CNIC in any form or the token
 * version. `hasPassword` says whether the office has set an app password. The profile parts are what
 * the apps read (side menu, profile, the driver's van).
 */
export interface SafeUserDto {
  id: UUID;
  phone: string;
  email: string | null;
  name: string;
  role: UserRoleValue;
  status: UserStatusValue;
  profilePictureUrl: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  hasPassword: boolean;
  distributorProfile: SafeUserDistributorProfile | null;
  driverProfile: SafeUserDriverProfile | null;
}

/** `GET /users/me`: the signed-in user's own {@link SafeUserDto}. */
export type MeDto = SafeUserDto;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** `POST /auth/login` and `POST /auth/refresh` (API_CONTRACT §7.1). */
export interface LoginResponse extends AuthTokens {
  role: UserRoleValue;
}

/** Claims carried by the access token (API_CONTRACT §7.1). `tv` must equal `users.token_version`. */
export interface AccessTokenClaims {
  sub: UUID;
  role: UserRoleValue;
  distributorId?: UUID | null;
  driverId?: UUID | null;
  tv: number;
}

/** The `X-App-Variant` header sent by new builds (API_CONTRACT §1.2). */
export type AppVariant = 'driver' | 'distributor' | 'admin-web';

export const APP_VARIANTS: readonly AppVariant[] = ['driver', 'distributor', 'admin-web'];

/**
 * Product names used in `AUTH_WRONG_APP` details (`details.app`, API_CONTRACT §2.3).
 * They are proper names, so they are not translated.
 */
export const APP_DISPLAY_NAME: Readonly<Record<AppVariant, string>> = {
  distributor: 'Smart Fleet shop app',
  driver: 'Smart Fleet Driver app',
  'admin-web': 'Smart Fleet Office website',
};
