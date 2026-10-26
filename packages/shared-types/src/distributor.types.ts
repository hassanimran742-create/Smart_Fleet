import type { IdName, Paisa, UUID } from './common.types';
import type { AppSeenDto } from './user.types';
import type { WalletSummary } from './wallet.types';

/** Mirrors Prisma `DistributorStatus`. Apps show PENDING as "Waiting to start". */
export const DistributorStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type DistributorStatus = (typeof DistributorStatus)[keyof typeof DistributorStatus];

/** The legacy distributor shape. New screens read {@link DistributorDto}. */
export interface Distributor {
  id: UUID;
  userId: UUID;
  businessName: string;
  homeStoreId: UUID;
  advanceBalancePaisa: Paisa;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
}

/** A distributor named inside another record (office views). `code` gives human numbers such as AG-0142. */
export interface DistributorRef {
  id: UUID;
  businessName: string;
  code: string;
}

/** The distributor's one store (ADR-01): every trip starts here. */
export interface DistributorStoreDto {
  id: UUID;
  name: string;
  address: string;
  lat: number;
  lng: number;
  zone: IdName;
}

export interface DistributorReadiness {
  storeSet: boolean;
  pricesComplete: boolean;
  appPasswordSet: boolean;
}

/** `GET /distributors`, `GET /distributors/:id`, `GET /distributors/me` (API_CONTRACT §7.3). */
export interface DistributorDto {
  id: UUID;
  /** The distributor's sign-in user: the office's "Set app password" calls `POST /users/:id/password`. */
  userId: UUID;
  /** `^[A-Z][A-Z0-9]{1,5}$`, locked after the first order (ADR-22). */
  code: string;
  businessName: string;
  status: DistributorStatus;
  contact: { name: string; phone: string; email: string | null };
  /** Null only while the store is not set up (`readiness.storeSet` false). */
  store: DistributorStoreDto | null;
  wallet: { balancePaisa: Paisa };
  /** Active zones with a delivery price, out of all active zones. */
  prices: { priced: number; total: number };
  appPasswordSet: boolean;
  /** Office views only; `GET /distributors/me` leaves it out. */
  readiness?: DistributorReadiness;
  codeLocked: boolean;
  /**
   * Office views only (API_CONTRACT §3.5): the last four CNIC digits, written "*****-****567-1"
   * (`maskCnic` in the API's common/security), or null when no CNIC is stored. `GET /distributors/me`
   * leaves it out, and the CNIC itself never leaves the server.
   */
  cnicMasked?: string | null;
  /**
   * Office views only: the shop app the distributor last used, against `app.minVersion.distributor` ("App: up
   * to date", "App: needs update"; API_CONTRACT §8.5 step 10). `GET /distributors/me` leaves it out.
   */
  app?: AppSeenDto;
}

/** `GET /distributor/home` (distributor): everything the home screen needs in one round trip. */
export interface DistributorHomeDto {
  distributor: { businessName: string; code: string; status: DistributorStatus; storeSet: boolean };
  wallet: WalletSummary;
  orders: { active: number; onTheWay: number; deliveredToday: number };
}
