/**
 * [Inc 3] The refill lane's test world (API_CONTRACT §10.1): the TEST_CASES standard data with Ahmed Gas's
 * labelled stock (AG-C0001…AG-C0020 11.8 kg, AG-C0021…AG-C0030 15 kg, AG-C0031…AG-C0035 45.4 kg, all FULL
 * in Ahmed Gas Store), "Lahore Filling Station", and the steps of the REF cases in their own words. The
 * scans, advances, cancels and receives go through the real routes as the named person; preconditions that
 * stand for earlier steps use the fixtures of test/helpers (refills.ts, runs.ts).
 *
 *   const w = await buildRefillWorld(app);
 *   await w.empty(1, 2);                                                   // AG-C0001, AG-C0002 EMPTY
 *   const r1 = await w.refill({ count: 2, assignTo: w.std.DR1 });         // AG-R001, ASSIGNED to Kashif
 *   await w.pickup(w.std.DR1, r1, 1).expect(201);
 *
 * Tests that needed the custody wiring the gate applies (the store's receive of a refill cylinder, the trip
 * finish and van check leaving refill cylinders out, the reconciliation retirement) waited on
 * SF_READY_LANES=inc3-gate (itAfterGate). The Inc 3 gate applied that wiring and turned them into plain
 * `it`; the helper stays for later lanes.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { CylinderState, type PrismaClient } from '@prisma/client';
import { ERROR_MESSAGE_EN, type ErrorCode } from '@smartfleet/shared-types';
import { renderMessage } from '@smartfleet/shared-utils';
import { SettingsService } from '../../../../src/modules/settings/settings.service';
import { authHeader, type TestActor } from '../../../helpers/auth';
import { registerStandardCylinders } from '../../../helpers/day-end';
import { getTestPrisma, walletMismatches } from '../../../helpers/db';
import { http, type TestRequest } from '../../../helpers/http';
import { refillCalls, type RefillCalls } from '../../../helpers/inc3-calls';
import { createRefill, createStation, type TestRefill, type TestStation } from '../../../helpers/refills';
import { setCylinderState, type TestCylinder } from '../../../helpers/runs';
import { scanCalls, type Caller, type ScanCalls } from '../../../helpers/scan-calls';
import { createStandardData, type StandardData } from '../../../helpers/standard-data';
import type { TestDriver } from '../../../helpers/factories';

export const API = '/api/v1';

// ---------- waiting on the gate ----------

const readyLanes = new Set(
  (process.env.SF_READY_LANES ?? '')
    .split(',')
    .map((lane) => lane.trim())
    .filter(Boolean),
);

/**
 * True once the Inc 3 gate has applied this lane's custody requests (ScanService.storeScanTx calling
 * refill-receive.ts, van.ts, van-check.job.ts, store.service.ts, history.service.ts and the reconciliation
 * retirement): SF_READY_LANES=inc3-gate or all.
 */
export const gateReady = readyLanes.has('all') || readyLanes.has('inc3-gate');

/** `it` once the gate applied this lane's requests, `it.skip` before: never a silent pass. */
export function itAfterGate(name: string, fn: jest.ProvidesCallback, timeout?: number): void {
  (gateReady ? it : it.skip)(`${name} [waits on the inc3 gate]`, fn, timeout);
}

// ---------- the world ----------

/** The catalogue's English for a code, filled from its details: what the API's `message` must be. */
export function messageOf(code: ErrorCode, details?: Record<string, unknown>): string {
  return renderMessage(ERROR_MESSAGE_EN[code], details);
}

function actorOf(caller: Caller): TestActor {
  return 'actor' in caller ? caller.actor : caller;
}

export interface RefillWorld {
  app: INestApplication;
  std: StandardData;
  db: PrismaClient;
  refills: RefillCalls;
  scans: ScanCalls;
  station: TestStation;
  /** AG-C000n. */
  ag(n: number): TestCylinder;
  /** Sets AG-C000n… to EMPTY in place (a fixture: no move). */
  empty(...numbers: number[]): Promise<void>;
  /** Sets AG-C000n to a state in place (a fixture: no move). */
  markState(n: number, state: CylinderState): Promise<void>;
  /** A refill request of Ahmed Gas numbered from its counter (AG-R001…), ASSIGNED when `assignTo` is given. */
  refill(opts?: { count?: number; size?: '11.8' | '15' | '45.4'; assignTo?: TestDriver }): Promise<TestRefill>;
  pickup(driver: Caller, refill: { id: string }, n: number, scanId?: string): TestRequest;
  fill(driver: Caller, refill: { id: string }, n: number, scanId?: string): TestRequest;
  advance(driver: Caller, refill: { id: string }, to: 'EMPTIES_PICKED' | 'FILLED'): TestRequest;
  /** Ahmed Gas's receive scan (`POST /store/scans`). */
  receive(n: number, scanId?: string): TestRequest;
  holder(n: number): Promise<{ custodyType: string; custodyId: string; state: string; lastEventId: string | null }>;
  events(n: number): Promise<Array<{ id: string; eventType: string; fillingOrderId: string | null; tripId: string | null; actorUserId: string }>>;
  ledgerCount(): Promise<number>;
  balance(): Promise<bigint>;
  as(caller: Caller): { get(url: string): TestRequest; post(url: string): TestRequest; patch(url: string): TestRequest };
  walletClean(): Promise<void>;
}

export async function buildRefillWorld(app: INestApplication): Promise<RefillWorld> {
  app.get(SettingsService).invalidate();
  const db = getTestPrisma();
  const std = await createStandardData();
  const stock = await registerStandardCylinders(std, { bilal: false });
  const station = await createStation();
  const refills = refillCalls(app);
  const scans = scanCalls(app);
  const sizes = { '11.8': std.sizes.kg11_8, '15': std.sizes.kg15, '45.4': std.sizes.kg45_4 } as const;
  const ag = (n: number): TestCylinder => {
    const code = `AG-C${String(n).padStart(4, '0')}`;
    const cylinder = stock.AG[code];
    if (!cylinder) throw new Error(`no ${code}`);
    return cylinder;
  };
  const as = (caller: Caller) => {
    const header = authHeader(actorOf(caller));
    const client = http(app);
    return {
      get: (url: string) => client.get(`${API}${url}`).set(header),
      post: (url: string) => client.post(`${API}${url}`).set(header),
      patch: (url: string) => client.patch(`${API}${url}`).set(header),
    };
  };
  return {
    app,
    std,
    db,
    refills,
    scans,
    station,
    ag,
    async empty(...numbers) {
      for (const n of numbers) await setCylinderState(ag(n).id, CylinderState.EMPTY);
    },
    async markState(n, state) {
      await setCylinderState(ag(n).id, state);
    },
    refill(opts = {}) {
      return createRefill({
        distributor: std.DA,
        cylinderTypeId: sizes[opts.size ?? '11.8'],
        requestedCount: opts.count ?? 2,
        station,
        ...(opts.assignTo ? { assignTo: opts.assignTo } : {}),
      });
    },
    pickup(driver, refill, n, scanId) {
      return refills.scan(driver, refill.id, { phase: 'PICKUP', code: ag(n).qrCode, ...(scanId ? { scanId } : {}) });
    },
    fill(driver, refill, n, scanId) {
      return refills.scan(driver, refill.id, { phase: 'FILL', code: ag(n).qrCode, ...(scanId ? { scanId } : {}) });
    },
    advance(driver, refill, to) {
      return refills.advance(driver, refill.id, to);
    },
    receive(n, scanId) {
      return scans.storeScan(std.DA, { code: ag(n).qrCode, ...(scanId ? { scanId } : {}) });
    },
    holder(n) {
      return db.cylinder.findUniqueOrThrow({
        where: { id: ag(n).id },
        select: { custodyType: true, custodyId: true, state: true, lastEventId: true },
      });
    },
    events(n) {
      return db.cylinderEvent.findMany({
        where: { cylinderId: ag(n).id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, eventType: true, fillingOrderId: true, tripId: true, actorUserId: true },
      });
    },
    ledgerCount() {
      return db.ledgerEntry.count();
    },
    async balance() {
      return (await db.distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).advanceBalancePaisa;
    },
    as,
    async walletClean() {
      expect(await walletMismatches()).toEqual([]);
    },
  };
}

/** A fresh scan id. */
export const scanId = (): string => randomUUID();
