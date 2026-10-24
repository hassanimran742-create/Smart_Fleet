import type { Address, IdName, UUID } from './common.types';
import type { PriceStatus, PriceView } from './pricing.types';

/** The legacy customer shape. New screens read {@link ClientDto}. */
export interface Client {
  id: UUID;
  distributorId: UUID;
  name: string;
  phone: string;
  addresses: Address[];
}

/** A saved delivery address (addresses are add-only in the pilot). */
export interface ClientAddressDto {
  id: UUID;
  label: string;
  lat: number;
  lng: number;
  /** The active zone covering the pin now (live check); null when outside every active zone. */
  zone: IdName | null;
  /** From the same live check, then this distributor's price in that zone. */
  priceStatus: PriceStatus;
}

/** A row of `GET /clients` (a bare array, as today). Installed apps may also read legacy fields. */
export interface ClientDto {
  id: UUID;
  name: string;
  /** Normalised `+923XXXXXXXXX`; older rows that could not be fixed keep what was typed. */
  phone: string;
  area: string | null;
  notes: string | null;
  addresses: ClientAddressDto[];
}

/** `POST /clients`: the customer, the address saved with it, and that address's delivery price. */
export interface ClientCreateResult {
  client: { id: UUID; name: string; phone: string; area: string | null; notes: string | null };
  address: { id: UUID; label: string; lat: number; lng: number; zone: IdName } | null;
  price: PriceView | null;
}

/**
 * [Inc 2] `PATCH /clients/:id` (the owning distributor): the customer as `GET /clients` lists it.
 * `confirmationNeedsNewLink` is true when the phone changed while a confirmation is pending, so the
 * shop makes a new link for the new number.
 */
export interface ClientUpdateResult extends ClientDto {
  confirmationNeedsNewLink?: boolean;
}

/** `POST /clients/:id/addresses`: the address passed the coverage check, so it has a zone and a price. */
export interface ClientAddressCreateResult {
  id: UUID;
  label: string;
  lat: number;
  lng: number;
  zone: IdName;
  price: PriceView;
  ok: true;
}
