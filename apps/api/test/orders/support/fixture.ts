/**
 * Shared steps of the api-orders suites, written in the words of TEST_CASES.md: place X1, assign DR1,
 * load-scan AG-C0005, cancel… Every helper goes through the HTTP API as the named person, except the
 * read-backs, which look at the database directly.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { authHeader, type TestActor } from '../../helpers/auth';
import { getTestPrisma, walletMismatches } from '../../helpers/db';
import { http, type TestRequest, type TestResponse } from '../../helpers/http';
import { x1OrderBody, x2OrderBody, type StandardData } from '../../helpers/standard-data';

export const API = '/api/v1';

/** A fresh Idempotency-Key. */
export function newKey(): string {
  return randomUUID();
}

/** The QR value of a standard cylinder ("AG-C0005" → "AG-C0005-QR", standard-data.ts). */
export function qrOf(code: string): string {
  return `${code}-QR`;
}

export function rs(rupees: number): bigint {
  return BigInt(Math.round(rupees * 100));
}

export class OrdersFixture {
  constructor(
    readonly app: INestApplication,
    readonly std: StandardData,
  ) {}

  get db(): PrismaClient {
    return getTestPrisma();
  }

  /** A request as a standard person (or any actor). */
  as(person: { actor: TestActor }) {
    const header = authHeader(person.actor);
    const client = http(this.app);
    const wrap = (req: TestRequest) => req.set(header);
    return {
      get: (url: string) => wrap(client.get(`${API}${url}`)),
      post: (url: string) => wrap(client.post(`${API}${url}`)),
      put: (url: string) => wrap(client.put(`${API}${url}`)),
      patch: (url: string) => wrap(client.patch(`${API}${url}`)),
      delete: (url: string) => wrap(client.delete(`${API}${url}`)),
    };
  }

  /** Without a token. */
  anonymous() {
    const client = http(this.app);
    return { get: (url: string) => client.get(`${API}${url}`) };
  }

  // ---------- orders ----------

  placeX1(key: string = newKey(), extra: Record<string, unknown> = {}): TestRequest {
    return this.as(this.std.DA).post('/orders').set('Idempotency-Key', key).send({ ...x1OrderBody(this.std), ...extra });
  }

  placeX2(key: string = newKey(), extra: Record<string, unknown> = {}): TestRequest {
    return this.as(this.std.DA).post('/orders').set('Idempotency-Key', key).send({ ...x2OrderBody(this.std), ...extra });
  }

  /** Places X1 and returns its OrderDto (expects 201). */
  async x1(): Promise<OrderBody> {
    return (await this.placeX1().expect(201)).body as OrderBody;
  }

  async x2(): Promise<OrderBody> {
    return (await this.placeX2().expect(201)).body as OrderBody;
  }

  /** SA1 assigns a driver; returns `{ tripId, driverId, originStoreId, reassignedFromTripId? }`. */
  async assign(
    orderId: string,
    driver: { id: string },
    reason?: string,
  ): Promise<{ tripId: string; driverId: string; originStoreId: string; reassignedFromTripId?: string | null }> {
    const res = await this.as(this.std.SA1)
      .post(`/orders/${orderId}/assign-driver`)
      .send({ driverId: driver.id, ...(reason ? { reason } : {}) })
      .expect(200);
    return res.body;
  }

  /** The driver's legacy load scan (SCAN_OUT) of a standard cylinder on a trip. */
  loadScan(driver: { actor: TestActor }, tripId: string, code = 'AG-C0005'): TestRequest {
    return this.as(driver).post('/custody/scan').send({ qrCode: qrOf(code), eventType: 'SCAN_OUT', tripId });
  }

  cancel(orderId: string, body: Record<string, unknown>, by: { actor: TestActor } = this.std.DA): TestRequest {
    return this.as(by).post(`/orders/${orderId}/cancel`).send(body);
  }

  fail(orderId: string, body: Record<string, unknown>, by: { actor: TestActor }): TestRequest {
    return this.as(by).post(`/orders/${orderId}/fail`).send(body);
  }

  // ---------- read-backs ----------

  async balance(distributor: { id: string } = this.std.DA): Promise<bigint> {
    return (await this.db.distributor.findUniqueOrThrow({ where: { id: distributor.id } })).advanceBalancePaisa;
  }

  /** Sets a balance with a matching ledger row, so the nightly check stays clean. */
  async setBalance(distributor: { id: string }, balance: bigint): Promise<void> {
    const current = await this.balance(distributor);
    if (current === balance) return;
    await this.db.$transaction([
      this.db.distributor.update({ where: { id: distributor.id }, data: { advanceBalancePaisa: balance } }),
      this.db.ledgerEntry.create({
        data: {
          distributorId: distributor.id,
          entryType: 'ADJUSTMENT',
          amountPaisa: balance - current,
          balanceAfterPaisa: balance,
          reasonCode: 'OTHER',
          note: 'Test balance set-up',
          idempotencyKey: `test-adjust:${randomUUID()}`,
        },
      }),
    ]);
  }

  ledger(where: Record<string, unknown> = {}) {
    return this.db.ledgerEntry.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  audits(action: string, resourceId?: string) {
    return this.db.auditLog.findMany({ where: { action, ...(resourceId ? { resourceId } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  order(id: string) {
    return this.db.order.findUniqueOrThrow({ where: { id } });
  }

  trip(id: string) {
    return this.db.trip.findUniqueOrThrow({ where: { id } });
  }

  stops(tripId: string) {
    return this.db.tripStop.findMany({ where: { tripId }, orderBy: { seq: 'asc' } });
  }

  cylinder(code: string) {
    return this.db.cylinder.findUniqueOrThrow({ where: { serial: code } });
  }

  async expectWalletsConsistent(): Promise<void> {
    expect(await walletMismatches()).toEqual([]);
  }

  /**
   * Extra FULL cylinders of one size in a distributor's store, for cases that load a fresh cylinder
   * every round. Their codes are `<prefix>-01`, `<prefix>-02` … (QR value `<code>-QR`, as qrOf()).
   */
  async extraCylinders(count: number, cylinderTypeId: string, prefix: string, distributor: { id: string; homeStoreId: string } = this.std.DA): Promise<string[]> {
    const codes = Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`);
    await this.db.cylinder.createMany({
      data: codes.map((code) => ({
        serial: code,
        qrCode: qrOf(code),
        distributorId: distributor.id,
        cylinderTypeId,
        state: 'FULL' as const,
        custodyType: 'STORE' as const,
        custodyId: distributor.homeStoreId,
      })),
    });
    return codes;
  }
}

/** The fields of an OrderDto the suites read. */
export interface OrderBody {
  id: string;
  orderNo: number;
  shortCode: string;
  status: string;
  stage: string;
  fee: { totalPaisa: string; status: string; breakdown: { basePaisa: string; lines: Array<Record<string, unknown>> } | null };
  cancel: { allowed: boolean; refundPaisa: string; noRefundReason: string | null };
  allowedActions: string[];
  trip: { id: string; status: string; driver: { id: string; name: string; phone: string }; vehicle: { plateNo: string } } | null;
  [key: string]: unknown;
}

/** Runs requests at the same moment and returns every answer. */
export function together(...requests: TestRequest[]): Promise<TestResponse[]> {
  return Promise.all(requests.map((req) => req.then((res) => res)));
}

/** Rupees as the API's digit string. */
export function paisa(rupees: number): string {
  return rs(rupees).toString();
}
