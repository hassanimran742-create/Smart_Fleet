/**
 * [Inc 3] Calls to the refill and day-end routes (API_CONTRACT §10.1, §10.2), typed on the shared request
 * schemas. Each returns supertest's request, so a test chains `.expect(200)` and reads the body as the
 * shared `FillingOrderDto`, `RefillScanResult`, `DayEndDayDto`, `DayEndUploadResult`… types.
 *
 *   const refills = refillCalls(app);
 *   const created = await refills.create(std.DA, { fillingStationId: station.id, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2 }, key).expect(201);
 *   await refills.scan(std.DR2, created.body.id, { phase: 'PICKUP', code: cyl.qrCode }).expect(201);
 *   const dayEnd = dayEndCalls(app);
 *   const sheet = (await dayEnd.sheet(std.DA, '2026-10-21').expect(200)).body as Buffer;
 *
 * Every scan gets a new `scanId` unless one is passed. Bodies are sent as given (no client-side checks),
 * so refusals can be tested too.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  CreateFillingOrderInput,
  DayEndApproveInput,
  DayEndReopenInput,
  DayEndSendBackInput,
  DayEndSubmitInput,
  RefillAdvanceInput,
  RefillScanInput,
} from '@smartfleet/shared-validation';
import { authHeader } from './auth';
import { NEW_SHOP_APP } from './app-headers';
import { binaryParser, http, type TestRequest } from './http';
import { API, type Caller } from './scan-calls';

function headers(caller: Caller): { Authorization: string } {
  return authHeader('actor' in caller ? caller.actor : caller);
}

/** A refill scan body; `scanId` and `entryMethod` (QR) are filled in when left out. */
export type RefillScanBody = Omit<RefillScanInput, 'scanId' | 'entryMethod'> & Partial<Pick<RefillScanInput, 'scanId' | 'entryMethod'>>;

/** The Inc 1 count-step routes the 0.1.0 driver app calls; from Inc 3 they answer 410 REFILL_USE_SCANS. */
export type LegacyRefillStep = 'picked-empties' | 'at-station' | 'filled' | 'returned';

export function refillCalls(app: INestApplication) {
  const api = http(app);
  const send = (req: TestRequest, caller: Caller, body?: unknown, idempotencyKey?: string): TestRequest => {
    let out = req.set(headers(caller));
    if (idempotencyKey) out = out.set('Idempotency-Key', idempotencyKey);
    return body === undefined ? out : out.send(body);
  };
  return {
    /** `POST /filling-orders` (the shop): 201 with the refill, or 200 `Idempotent-Replay` for a retry with the same key. */
    create(shop: Caller, body: CreateFillingOrderInput & Record<string, unknown>, idempotencyKey?: string): TestRequest {
      // The Inc 3 shop app's call: the 0.1.0 JS (no X-App-* header) is answered 426 here (Appendix A).
      return send(api.post(`${API}/filling-orders`).set(NEW_SHOP_APP), shop, body, idempotencyKey);
    },
    /** `GET /filling-orders/:id` (`canSeeRefill`: the office, the owner, the assigned driver). */
    get(caller: Caller, id: string): TestRequest {
      return send(api.get(`${API}/filling-orders/${id}`), caller);
    },
    /** `GET /filling-orders/mine` (the shop, a bare array). */
    mine(shop: Caller): TestRequest {
      return send(api.get(`${API}/filling-orders/mine`), shop);
    },
    /** `GET /filling-orders/driver/mine` (the driver, a bare array). */
    driverMine(driver: Caller): TestRequest {
      return send(api.get(`${API}/filling-orders/driver/mine`), driver);
    },
    /** `GET /filling-orders` (the office). */
    list(office: Caller, query: Record<string, unknown> = {}): TestRequest {
      return send(api.get(`${API}/filling-orders`).query(query), office);
    },
    /** `PATCH /filling-orders/:id/assign` (the office) `{ driverId }`. */
    assign(office: Caller, id: string, driverId: string): TestRequest {
      return send(api.patch(`${API}/filling-orders/${id}/assign`), office, { driverId });
    },
    /** `POST /filling-orders/:id/scans` (the assigned driver): PICKUP or FILL. */
    scan(driver: Caller, id: string, body: RefillScanBody & Record<string, unknown>): TestRequest {
      return send(api.post(`${API}/filling-orders/${id}/scans`), driver, { scanId: randomUUID(), entryMethod: 'QR', ...body });
    },
    /** `POST /filling-orders/:id/advance` (the assigned driver): "Leave store" (EMPTIES_PICKED) or "Leave station" (FILLED). */
    advance(driver: Caller, id: string, to: RefillAdvanceInput['to']): TestRequest {
      return send(api.post(`${API}/filling-orders/${id}/advance`), driver, { to });
    },
    /** `PATCH /filling-orders/:id/cancel` (the owner, before pickup) `{ reason }`. */
    cancel(shop: Caller, id: string, reason = 'Not needed any more'): TestRequest {
      return send(api.patch(`${API}/filling-orders/${id}/cancel`), shop, { reason });
    },
    /** The retired count steps (`PATCH /filling-orders/:id/<step>`). */
    legacyStep(driver: Caller, id: string, step: LegacyRefillStep, body: Record<string, unknown> = {}): TestRequest {
      return send(api.patch(`${API}/filling-orders/${id}/${step}`), driver, body);
    },
    /** The retired office "Mark complete" (`PATCH /filling-orders/:id/complete`). */
    complete(office: Caller, id: string): TestRequest {
      return send(api.patch(`${API}/filling-orders/${id}/complete`), office, {});
    },
  };
}

export type RefillCalls = ReturnType<typeof refillCalls>;

export function dayEndCalls(app: INestApplication) {
  const api = http(app);
  const send = (req: TestRequest, caller: Caller, body?: unknown): TestRequest => {
    const out = req.set(headers(caller));
    return body === undefined ? out : out.send(body);
  };
  return {
    /** `GET /day-end` (the shop): its days that have a row, newest first. */
    list(shop: Caller, query: Record<string, unknown> = {}): TestRequest {
      return send(api.get(`${API}/day-end`).query(query), shop);
    },
    /** `GET /day-end/:date` (the shop): `DayEndDayDto`. */
    day(shop: Caller, date: string): TestRequest {
      return send(api.get(`${API}/day-end/${date}`), shop);
    },
    /** `GET /day-end/:date/sheet.xlsx` (the shop): a new sheet. `res.body` is the file's bytes (a Buffer). */
    sheet(shop: Caller, date: string): TestRequest {
      return send(api.get(`${API}/day-end/${date}/sheet.xlsx`), shop).buffer(true).parse(binaryParser);
    },
    /** `POST /day-end/:date/upload` (the shop): multipart field `file`. */
    upload(shop: Caller, date: string, file: Buffer, filename = 'day-end.xlsx'): TestRequest {
      return send(api.post(`${API}/day-end/${date}/upload`), shop).attach('file', file, {
        filename,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    },
    /** `POST /day-end/:date/submit` (the shop) `{ version, note? }`. */
    submit(shop: Caller, date: string, body: DayEndSubmitInput | Record<string, unknown>): TestRequest {
      return send(api.post(`${API}/day-end/${date}/submit`), shop, body);
    },
    /** `GET /admin/day-end?status&cursor` (the office). */
    adminList(office: Caller, query: Record<string, unknown> = {}): TestRequest {
      return send(api.get(`${API}/admin/day-end`).query(query), office);
    },
    /** `GET /admin/day-end/:id` (the office). */
    adminDay(office: Caller, id: string): TestRequest {
      return send(api.get(`${API}/admin/day-end/${id}`), office);
    },
    /** `POST /admin/day-end/:id/approve` (the office) `{ version }`. */
    approve(office: Caller, id: string, body: DayEndApproveInput | Record<string, unknown>): TestRequest {
      return send(api.post(`${API}/admin/day-end/${id}/approve`), office, body);
    },
    /** `POST /admin/day-end/:id/send-back` (the office) `{ reason }`. */
    sendBack(office: Caller, id: string, body: DayEndSendBackInput | Record<string, unknown>): TestRequest {
      return send(api.post(`${API}/admin/day-end/${id}/send-back`), office, body);
    },
    /** `POST /admin/day-end/:id/reopen` (the office) `{ reason }`. */
    reopen(office: Caller, id: string, body: DayEndReopenInput | Record<string, unknown>): TestRequest {
      return send(api.post(`${API}/admin/day-end/${id}/reopen`), office, body);
    },
  };
}

export type DayEndCalls = ReturnType<typeof dayEndCalls>;
