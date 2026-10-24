/**
 * [Inc 2] Calls to the driver, store and office scan routes (API_CONTRACT §9.3-§9.5, §9.10), typed on the
 * shared request schemas. Each returns supertest's request, so a test chains `.expect(201)` and reads the
 * body as the shared `ScanResult`, `StoreScanResult`, `StopFinishResult`… types.
 *
 *   const scans = scanCalls(app);
 *   const res = await scans.tripScan(std.DR1, trip.id, { stopId: trip.pickupStopId, action: 'LOAD', code: cyl.qrCode }).expect(201);
 *   await scans.tripScan(std.DR1, trip.id, { stopId, action: 'TAKE_BACK', code: String(old.shortNo), entryMethod: 'TYPED', returnState: 'EMPTY' });
 *   await scans.storeScan(std.DA, { code: cyl.qrCode }).expect(201);
 *
 * Every scan gets a new `scanId` unless one is passed: pass the same `scanId` twice to test a resend.
 * Bodies are sent as given (no client-side checks), so refusals can be tested too.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  FinishStopInput,
  FinishTripInput,
  ManualDeliveryV2Input,
  StoreScanInput,
  TripScanInput,
  UnlabelledReturnsInput,
} from '@smartfleet/shared-validation';
import { authHeader, type TestActor } from './auth';
import { http, type TestRequest } from './http';

export const API = '/api/v1';

/** Anyone the token helpers can sign for: a factory person (`{ actor }`) or a bare actor. */
export type Caller = { actor: TestActor } | TestActor;

function headers(caller: Caller): { Authorization: string } {
  return authHeader('actor' in caller ? caller.actor : caller);
}

/** A trip scan body; `scanId` and `entryMethod` (QR) are filled in when left out. */
export type TripScanBody = Omit<TripScanInput, 'scanId' | 'entryMethod'> & Partial<Pick<TripScanInput, 'scanId' | 'entryMethod'>>;
/** A store scan body; `scanId` and `entryMethod` (QR) are filled in when left out. */
export type StoreScanBody = Omit<StoreScanInput, 'scanId' | 'entryMethod'> & Partial<Pick<StoreScanInput, 'scanId' | 'entryMethod'>>;

export function scanCalls(app: INestApplication) {
  const api = http(app);
  const send = (req: TestRequest, caller: Caller, body?: unknown, idempotencyKey?: string): TestRequest => {
    let out = req.set(headers(caller));
    if (idempotencyKey) out = out.set('Idempotency-Key', idempotencyKey);
    return body === undefined ? out : out.send(body);
  };
  return {
    /** `POST /trips/:tripId/scans` (the trip's driver): LOAD, HANDOVER or TAKE_BACK at a stop. */
    tripScan(driver: Caller, tripId: string, body: TripScanBody & Record<string, unknown>): TestRequest {
      return send(api.post(`${API}/trips/${tripId}/scans`), driver, { scanId: randomUUID(), entryMethod: 'QR', ...body });
    },
    /** `POST /store/scans` (the shop): the store's receive (STORE_RECEIVE, SCAN_IN). */
    storeScan(shop: Caller, body: StoreScanBody & Record<string, unknown>): TestRequest {
      return send(api.post(`${API}/store/scans`), shop, { scanId: randomUUID(), entryMethod: 'QR', ...body });
    },
    /** `PUT /trips/:tripId/stops/:stopId/unlabelled-returns`: replaces the stop's whole list. */
    unlabelledReturns(driver: Caller, tripId: string, stopId: string, items: UnlabelledReturnsInput['items']): TestRequest {
      return send(api.put(`${API}/trips/${tripId}/stops/${stopId}/unlabelled-returns`), driver, { items });
    },
    /** `POST /trips/:tripId/stops/:stopId/finish`: "Done loading" or "Finish visit". */
    finishStop(driver: Caller, tripId: string, stopId: string, body: FinishStopInput = {}): TestRequest {
      return send(api.post(`${API}/trips/${tripId}/stops/${stopId}/finish`), driver, body);
    },
    /** `POST /trips/:tripId/finish` ("Finish trip"). */
    finishTrip(driver: Caller, tripId: string, body: FinishTripInput = {}): TestRequest {
      return send(api.post(`${API}/trips/${tripId}/finish`), driver, body);
    },
    /** `GET /trips/:tripId` (Inc 2 shape: `TripDetailDto`). */
    trip(caller: Caller, tripId: string): TestRequest {
      return send(api.get(`${API}/trips/${tripId}`), caller);
    },
    /** `GET /trips/:tripId/stops/:stopId` (`StopDetailDto`). */
    stop(driver: Caller, tripId: string, stopId: string): TestRequest {
      return send(api.get(`${API}/trips/${tripId}/stops/${stopId}`), driver);
    },
    /** `GET /driver/home` (`DriverHomeDto`). */
    driverHome(driver: Caller): TestRequest {
      return send(api.get(`${API}/driver/home`), driver);
    },
    /** `GET /store/incoming` (`StoreIncomingDto`). */
    storeIncoming(shop: Caller): TestRequest {
      return send(api.get(`${API}/store/incoming`), shop);
    },
    /** `GET /store/stock` (`StoreStockDto`). */
    storeStock(shop: Caller): TestRequest {
      return send(api.get(`${API}/store/stock`), shop);
    },
    /** `GET /cylinders/:code/history` (`CylinderHistoryDto`): a QR value or a cylinder number. */
    cylinderHistory(caller: Caller, code: string): TestRequest {
      return send(api.get(`${API}/cylinders/${encodeURIComponent(code)}/history`), caller);
    },
    /** `POST /orders/:id/manual-delivery` v2 (office): the named cylinders. */
    manualDelivery(office: Caller, orderId: string, body: ManualDeliveryV2Input): TestRequest {
      return send(api.post(`${API}/orders/${orderId}/manual-delivery`), office, body);
    },
    /** `POST /orders/:id/fail` (the trip's driver or the office). */
    failOrder(caller: Caller, orderId: string, body: { reasonCode: string; note?: string }): TestRequest {
      return send(api.post(`${API}/orders/${orderId}/fail`), caller, body);
    },
    /** The legacy `POST /custody/scan` (installed 0.1.0 driver app), which delegates to the scan service in Inc 2. */
    legacyScan(driver: Caller, body: { qrCode: string; eventType: string; tripId: string; orderId?: string }): TestRequest {
      return send(api.post(`${API}/custody/scan`), driver, body);
    },
    /** `POST /cylinders/bulk-register` (office): `BulkRegisteredCylinder[]` from Inc 2. */
    bulkRegister(
      office: Caller,
      body: { distributorId: string; cylinderTypeId: string; quantity?: number; serials?: string[]; state?: 'FULL' | 'EMPTY' },
    ): TestRequest {
      return send(api.post(`${API}/cylinders/bulk-register`), office, body);
    },
  };
}

export type ScanCalls = ReturnType<typeof scanCalls>;
