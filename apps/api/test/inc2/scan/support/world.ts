/**
 * [Inc 2] The scan lane's test world: the TEST_CASES standard data with the 35 labelled Ahmed Gas
 * cylinders (AG-C0001 to AG-C0020 are 11.8 kg, AG-C0021 to AG-C0030 15 kg, AG-C0031 to AG-C0035 45.4 kg,
 * each with its label number and a REGISTERED move), plus steps written in the cases' words. Orders,
 * assignments, scans and finishes go through the real API as the named person; fixtures that stand for
 * "an earlier run" are written the way ScanService writes them (helpers/runs.ts).
 *
 *   const w = await buildWorld(app);
 *   const x1 = await w.placeOrder(X1);                       // Rs 250, balance Rs 4,750
 *   const t1 = await w.assign(x1, w.std.DR1);                // trip T1 on LEA-101
 *   await w.load(w.std.DR1, t1, [1, 2, 31]);                 // AG-C0001, AG-C0002, AG-C0031
 *   await w.doneLoading(w.std.DR1, t1);
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { CylinderState, type PrismaClient } from '@prisma/client';
import { ERROR_MESSAGE_EN, type ErrorCode } from '@smartfleet/shared-types';
import { renderMessage } from '@smartfleet/shared-utils';
import { SettingsService } from '../../../../src/modules/settings/settings.service';
import { authHeader, type TestActor } from '../../../helpers/auth';
import { getTestPrisma, walletMismatches } from '../../../helpers/db';
import { createDistributor, createStore, type TestDriver } from '../../../helpers/factories';
import { http, type TestRequest, type TestResponse } from '../../../helpers/http';
import { placeWithCustomer, registerCylinders, setCylinderState, type TestCylinder } from '../../../helpers/runs';
import { scanCalls, type Caller, type ScanCalls } from '../../../helpers/scan-calls';
import { createStandardData, type StandardData } from '../../../helpers/standard-data';

export const API = '/api/v1';

/** A size of the standard data. */
export type Size = '11.8' | '15' | '45.4' | '6';

/** An order line in the cases' words: `2 × 11.8 kg, 2 back`. */
export interface Line {
  size: Size;
  full: number;
  back?: number;
}

/** The standard orders (TEST_CASES "Worked money examples"). `back` defaults to 0: most cases say "expects no returns". */
export const X1: Line[] = [
  { size: '11.8', full: 2 },
  { size: '45.4', full: 1 },
];
export const X2: Line[] = [{ size: '15', full: 3 }];
export const Y1: Line[] = [{ size: '11.8', full: 1 }];

export interface PlacedOrder {
  id: string;
  shortCode: string;
  clientId: string;
}

export interface Trip {
  id: string;
  pickupStopId: string;
  vehicleId: string;
  stopFor(orderId: string): Promise<string>;
}

export interface World {
  app: INestApplication;
  std: StandardData;
  scans: ScanCalls;
  db: PrismaClient;
  /** AG-C000n. */
  ag(n: number): TestCylinder;
  /** Bilal Gas cylinders (BG-C000n), made on demand in Bilal Gas's store unless placed elsewhere. */
  bg(n: number, size?: Size): Promise<TestCylinder>;
  sizeId(size: Size): string;
  placeOrder(lines: Line[], client?: 'C1' | 'C2'): Promise<PlacedOrder>;
  assign(order: PlacedOrder, driver: TestDriver, reason?: string): Promise<Trip>;
  trip(tripId: string): Promise<Trip>;
  load(driver: Caller, trip: Trip, cylinders: number[]): Promise<void>;
  doneLoading(driver: Caller, trip: Trip): Promise<void>;
  hand(driver: Caller, trip: Trip, order: PlacedOrder, cylinders: number[]): Promise<void>;
  takeBack(driver: Caller, trip: Trip, order: PlacedOrder, n: number, returnState: 'EMPTY' | 'PART_FILLED' | 'FULL'): Promise<void>;
  finishVisit(driver: Caller, trip: Trip, order: PlacedOrder, body?: Record<string, unknown>): Promise<TestResponse>;
  receive(n: number): Promise<TestResponse>;
  /** Fixture F1 and friends: a cylinder with a customer from an earlier finished run (no money). */
  withCustomer(n: number, client: 'C1' | 'C2'): Promise<void>;
  markState(n: number, state: CylinderState): Promise<void>;
  setting(key: string, value: unknown): Promise<void>;
  balance(): Promise<bigint>;
  topUp(rupees: number): Promise<void>;
  holder(n: number): Promise<{ custodyType: string; custodyId: string; state: string }>;
  eventCount(n: number, eventType?: string): Promise<number>;
  as(caller: Caller): { get(url: string): TestRequest; post(url: string): TestRequest; put(url: string): TestRequest; patch(url: string): TestRequest };
  walletClean(): Promise<void>;
}

/** The catalogue's English for a code, filled from its details: what the API's `message` must be. */
export function messageOf(code: ErrorCode, details?: Record<string, unknown>): string {
  return renderMessage(ERROR_MESSAGE_EN[code], details);
}

function actorOf(caller: Caller): TestActor {
  return 'actor' in caller ? caller.actor : caller;
}

/** The standard data with 35 labelled Ahmed Gas cylinders, and the steps of the cases. */
export async function buildWorld(app: INestApplication): Promise<World> {
  app.get(SettingsService).invalidate();
  const db = getTestPrisma();
  const std = await createStandardData();
  const office = std.SA1;
  const ag = [
    ...(await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 20, actor: office })),
    ...(await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg15, count: 10, actor: office })),
    ...(await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg45_4, count: 5, actor: office })),
  ];
  const bgs = new Map<number, TestCylinder>();
  const scans = scanCalls(app);
  const sizeId = (size: Size) =>
    ({ '11.8': std.sizes.kg11_8, '15': std.sizes.kg15, '45.4': std.sizes.kg45_4, '6': std.sizes.kg6 })[size];
  const as = (caller: Caller) => {
    const header = authHeader(actorOf(caller));
    const client = http(app);
    return {
      get: (url: string) => client.get(`${API}${url}`).set(header),
      post: (url: string) => client.post(`${API}${url}`).set(header),
      put: (url: string) => client.put(`${API}${url}`).set(header),
      patch: (url: string) => client.patch(`${API}${url}`).set(header),
    };
  };
  const agOf = (n: number) => {
    const cylinder = ag[n - 1];
    if (!cylinder) throw new Error(`no AG-C${String(n).padStart(4, '0')}`);
    return cylinder;
  };
  const tripOf = async (tripId: string): Promise<Trip> => {
    const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId }, select: { id: true, vehicleId: true } });
    const pickup = await db.tripStop.findFirstOrThrow({ where: { tripId, stopType: 'STORE_PICKUP' }, select: { id: true } });
    return {
      id: trip.id,
      vehicleId: trip.vehicleId,
      pickupStopId: pickup.id,
      async stopFor(orderId: string) {
        const stop = await db.tripStop.findFirstOrThrow({
          where: { tripId, orderId, stopType: 'DELIVERY' },
          orderBy: { seq: 'desc' },
          select: { id: true },
        });
        return stop.id;
      },
    };
  };
  const expectStatus = (res: TestResponse, status: number, what: string) => {
    if (res.status !== status) throw new Error(`${what}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
  };

  const world: World = {
    app,
    std,
    scans,
    db,
    ag: agOf,
    async bg(n, size = '11.8') {
      const known = bgs.get(n);
      if (known) return known;
      while (bgs.size < n) {
        const [made] = await registerCylinders({ distributor: std.DB, cylinderTypeId: sizeId(size), count: 1, actor: office });
        bgs.set(made.shortNo, made);
      }
      return bgs.get(n) as TestCylinder;
    },
    sizeId,
    async placeOrder(lines, client = 'C1') {
      const customer = client === 'C1' ? std.C1 : std.C2;
      const res = await as(std.DA)
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({
          clientId: customer.id,
          addressId: customer.addressId,
          deliveryLabel: client === 'C1' ? "Sana's house" : "Usman's house",
          lines: lines.map((line) => ({ cylinderTypeId: sizeId(line.size), fullCount: line.full, expectedReturnCount: line.back ?? 0 })),
        });
      expectStatus(res, 201, 'place order');
      return { id: res.body.id, shortCode: res.body.shortCode, clientId: customer.id };
    },
    async assign(order, driver, reason) {
      const res = await as(std.SA1)
        .post(`/orders/${order.id}/assign-driver`)
        .send({ driverId: driver.id, ...(reason ? { reason } : {}) });
      expectStatus(res, 200, 'assign');
      return tripOf(res.body.tripId);
    },
    trip: tripOf,
    async load(driver, trip, cylinders) {
      for (const n of cylinders) {
        const res = await scans.tripScan(driver, trip.id, { stopId: trip.pickupStopId, action: 'LOAD', code: agOf(n).qrCode });
        expectStatus(res, 201, `LOAD AG-C${n}`);
      }
    },
    async doneLoading(driver, trip) {
      const res = await scans.finishStop(driver, trip.id, trip.pickupStopId);
      expectStatus(res, 200, 'Done loading');
    },
    async hand(driver, trip, order, cylinders) {
      const stopId = await trip.stopFor(order.id);
      for (const n of cylinders) {
        const res = await scans.tripScan(driver, trip.id, { stopId, action: 'HANDOVER', code: agOf(n).qrCode });
        expectStatus(res, 201, `HANDOVER AG-C${n}`);
      }
    },
    async takeBack(driver, trip, order, n, returnState) {
      const stopId = await trip.stopFor(order.id);
      const res = await scans.tripScan(driver, trip.id, { stopId, action: 'TAKE_BACK', code: agOf(n).qrCode, returnState });
      expectStatus(res, 201, `TAKE_BACK AG-C${n}`);
    },
    async finishVisit(driver, trip, order, body = {}) {
      return scans.finishStop(driver, trip.id, await trip.stopFor(order.id), body);
    },
    async receive(n) {
      return scans.storeScan(std.DA, { code: agOf(n).qrCode });
    },
    async withCustomer(n, client) {
      await placeWithCustomer({ cylinder: agOf(n), client: client === 'C1' ? std.C1 : std.C2, actor: std.DR2 });
    },
    async markState(n, state) {
      await setCylinderState(agOf(n).id, state);
    },
    async setting(key, value) {
      const res = await as(std.SA1).patch(`/settings/${key}`).send({ value, reason: 'Test set-up for the scan lane' });
      expectStatus(res, 200, `setting ${key}`);
    },
    async balance() {
      return (await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).advanceBalancePaisa;
    },
    async topUp(rupees) {
      const add = BigInt(rupees * 100);
      const current = await world.balance();
      await db.$transaction([
        db.distributor.update({ where: { id: std.DA.id }, data: { advanceBalancePaisa: current + add } }),
        db.ledgerEntry.create({
          data: {
            distributorId: std.DA.id,
            entryType: 'ADJUSTMENT',
            amountPaisa: add,
            balanceAfterPaisa: current + add,
            reasonCode: 'OTHER',
            note: 'Scan lane test top-up',
            idempotencyKey: `test-adjust:${randomUUID()}`,
          },
        }),
      ]);
    },
    async holder(n) {
      return db.cylinder.findUniqueOrThrow({ where: { id: agOf(n).id }, select: { custodyType: true, custodyId: true, state: true } });
    },
    async eventCount(n, eventType) {
      return db.cylinderEvent.count({ where: { cylinderId: agOf(n).id, ...(eventType ? { eventType: eventType as never } : {}) } });
    },
    as,
    async walletClean() {
      expect(await walletMismatches()).toEqual([]);
    },
  };
  return world;
}

/** A second distributor's store holding a cylinder: for "in another shop's store" cases. */
export async function otherStore(world: World) {
  return createStore({ zone: world.std.zones.South, name: 'Some other store' });
}

export { createDistributor };
