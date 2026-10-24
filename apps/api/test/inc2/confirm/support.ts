/**
 * Shared set-up for the confirmation lane's suites (CNF, CAS, MSG): the API with the public page wired
 * as CUSTOMER_PAGE §5 says, the X1 delivery of the cases ("Standard D1 set-up"), calls to the public
 * page from their own IPs, a spy provider, and small readers.
 *
 * - `createConfirmApp()` is test/helpers/app.ts's createTestApp with providers that can be overridden;
 *   configureApp (as main.ts runs it) keeps the page outside `/api/v1` (CONFIRM_PAGE_PREFIX_EXCLUDE,
 *   wired at the Inc 2 gate).
 * - `deliverX1()` builds the delivery with the run fixtures (helpers/runs.ts) and delivers it the way the
 *   stop finish does: the order DELIVERED and the stop DONE in one transaction that also issues the
 *   confirmation, then the SMS after commit. Cases about the finish route itself run the real route
 *   (the gate merged the scan lane and turned `itWithScanLane`/`itAfterGate` into plain `it`; the helpers
 *   stay for later lanes).
 */
import type { INestApplication } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import { DiscoveryService } from '@nestjs/core';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { DeliveryMethod, OrderStatus, Prisma } from '@prisma/client';
import Redis from 'ioredis';
import type { SettingKey, SettingValue } from '@smartfleet/shared-types';
import { AppModule } from '../../../src/app.module';
import { systemActor } from '../../../src/common/auth/actor';
import { installBigIntJson } from '../../../src/common/bootstrap/bigint-json';
import { configureApp } from '../../../src/common/bootstrap/configure-app';
import { ConfirmationService, type IssuedConfirmation } from '../../../src/modules/confirmation/confirmation.interface';
import { MESSAGING_PROVIDER, MessagingServiceImpl, MockMessagingProvider, type MessagingProvider, type OutboundRequest, type SendResult } from '../../../src/modules/messaging/messaging.interface';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { confirmationToken } from '../../helpers/customer-links';
import { assertSafeTestDatabase, getTestPrisma, resetDb } from '../../helpers/db';
import { http, type TestRequest } from '../../helpers/http';
import {
  createOrder,
  createTrip,
  handOver,
  loadVan,
  placeWithCustomer,
  registerCylinders,
  takeBack,
  type TestCylinder,
  type TestOrder,
  type TestTrip,
} from '../../helpers/runs';
import { createStandardData, type StandardData } from '../../helpers/standard-data';

// The cases' environment (CNF-003 precondition): links on smartfleetpk.com; the mock provider.
process.env.PUBLIC_LINK_BASE_URL ??= 'https://smartfleetpk.com';

export const BOOT_TIMEOUT_MS = 120_000;
export const CASE_TIMEOUT_MS = 90_000;
export const LINK_BASE = () => (process.env.PUBLIC_LINK_BASE_URL ?? '').replace(/\/+$/, '');

/** The X1 cost (Rs 250 + 2 × Rs 40 + Rs 150) and DA's balance after one X1 (TEST_CASES "Worked money examples"). */
export const X1_FEE_PAISA = 48_000n;

// ---------- waiting on another lane ----------

const readyLanes = new Set(
  (process.env.SF_READY_LANES ?? '')
    .split(',')
    .map((lane) => lane.trim())
    .filter(Boolean),
);
/** True once the scan lane's routes (the stop finish, the manual delivery v2) are merged. */
export const scanLaneReady = readyLanes.has('all') || readyLanes.has('inc2-scan');
/** True once the gate has applied this lane's requests (the boot guards, the clients PATCH, the order lists). */
export const gateReady = readyLanes.has('all') || readyLanes.has('inc2-gate');

/** `it` once the scan lane is in (SF_READY_LANES=inc2-scan or all), `it.skip` before; never a silent pass. */
export function itWithScanLane(name: string, fn: jest.ProvidesCallback, timeout?: number): void {
  (scanLaneReady ? it : it.skip)(`${name} [waits on inc2-scan]`, fn, timeout);
}

/** `it` once the gate applied this lane's requests (SF_READY_LANES=inc2-gate or all), `it.skip` before. */
export function itAfterGate(name: string, fn: jest.ProvidesCallback, timeout?: number): void {
  (gateReady ? it : it.skip)(`${name} [waits on the inc2 gate]`, fn, timeout);
}

// ---------- the app ----------

/**
 * AppModule with the HTTP set-up of main.ts (configureApp) and the public page's prefix exclusion,
 * listening on a loopback port. Override providers with `customize`.
 */
export async function createConfirmApp(customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder): Promise<INestApplication> {
  assertSafeTestDatabase();
  installBigIntJson();
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (customize ? customize(builder) : builder).compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  await settleWorkers(app);
  await app.listen(0, '127.0.0.1');
  return app;
}

/** As test/helpers/app.ts: every BullMQ worker connected, with an error listener. */
async function settleWorkers(app: INestApplication): Promise<void> {
  let discovery: DiscoveryService;
  try {
    discovery = app.get(DiscoveryService, { strict: false });
  } catch {
    return;
  }
  for (const wrapper of discovery.getProviders()) {
    const instance: unknown = wrapper.instance;
    if (!(instance instanceof WorkerHost)) continue;
    const worker = (instance as WorkerHost).worker;
    if (!worker) continue;
    worker.on('error', () => undefined);
    await worker.waitUntilReady().catch(() => undefined);
  }
}

/** Sets a setting as the settings CLI would (audited, SYSTEM); the cache is cleared on commit. */
export async function setSetting<K extends SettingKey>(app: INestApplication, key: K, value: SettingValue<K>, reason = 'Confirmation lane test'): Promise<void> {
  await app.get(SettingsService).set(key, value, systemActor('cli:settings'), reason, { allowNotEditable: true });
}

/**
 * A fresh database with the standard data and the cases' confirmation settings: `confirmation.enabled`
 * on (unless `enabled: false`), 72-hour links, cases for NO and OTHER, test mode on with an empty allowlist.
 */
export async function freshStandard(app: INestApplication, opts: { enabled?: boolean } = {}): Promise<StandardData> {
  await resetDb();
  app.get(SettingsService).invalidate();
  await clearPageLimits();
  const std = await createStandardData();
  if (opts.enabled !== false) await setSetting(app, 'confirmation.enabled', true);
  return std;
}

// ---------- the X1 delivery ----------

export interface X1Options {
  /** Expected returns of the 11.8 kg line (the cases use 0 or 2). Default 0. */
  takeBack118?: number;
  /** Unlabelled returns recorded at the door. Default 1 × 11.8 kg EMPTY and 1 × 11.8 kg PART_FILLED. */
  unlabelled?: Array<{ size: 'kg6' | 'kg11_8' | 'kg15' | 'kg45_4'; state: 'EMPTY' | 'PART_FILLED' | 'FULL'; count: number }>;
  /** Labelled take-backs: cylinders already with the customer, taken back on this visit. */
  takenBack?: Array<{ size: 'kg6' | 'kg11_8' | 'kg15' | 'kg45_4'; state: 'EMPTY' | 'PART_FILLED' | 'FULL' }>;
  /** Deliver it (default true); false stops after the hand-overs, before the visit is finished. */
  deliver?: boolean;
  /** Hand the cylinders over at the door (default true); false leaves them loaded on the van. */
  handOver?: boolean;
  /** The order's cost; default X1's Rs 480. */
  feePaisa?: bigint;
  /** The customer; default C1 Sana. */
  client?: 'C1' | 'C2';
  /** Other order lines than X1's (each size handed over in full). */
  lines?: Array<{ size: 'kg6' | 'kg11_8' | 'kg15' | 'kg45_4'; count: number; expectedReturnCount?: number }>;
}

export interface X1Delivery {
  order: TestOrder;
  trip: TestTrip;
  stopId: string;
  given: TestCylinder[];
  issued: IssuedConfirmation | null;
  /** The confirmation row's id, once issued. */
  confirmationId: string | null;
  /** The current link token, once issued. */
  token: string | null;
}

/**
 * X1 for C1 Sana (2 × 11.8 kg + 1 × 45.4 kg, Rs 480 deducted at placement), assigned to DR1 Kashif
 * (LEA-101), loaded at Ahmed Gas Store, every cylinder handed over at Sana's stop, the unlabelled
 * returns recorded; then delivered as the visit finish delivers it (unless `deliver: false`).
 */
export async function deliverX1(app: INestApplication, std: StandardData, opts: X1Options = {}): Promise<X1Delivery> {
  const db = getTestPrisma();
  const client = opts.client === 'C2' ? std.C2 : std.C1;
  const lines = opts.lines ?? [
    { size: 'kg11_8' as const, count: 2, expectedReturnCount: opts.takeBack118 ?? 0 },
    { size: 'kg45_4' as const, count: 1, expectedReturnCount: 0 },
  ];
  const order = await createOrder({
    distributor: std.DA,
    client,
    feePaisa: opts.feePaisa ?? X1_FEE_PAISA,
    lines: lines.map((line) => ({ cylinderTypeId: std.sizes[line.size], fullCount: line.count, expectedReturnCount: line.expectedReturnCount ?? 0 })),
  });
  const trip = await createTrip({ driver: std.DR1, distributor: std.DA, orders: [order] });
  const given: TestCylinder[] = [];
  for (const line of lines) given.push(...(await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes[line.size], count: line.count })));
  await loadVan({ trip, driver: std.DR1, cylinders: given, finishLoading: true });
  if (opts.handOver !== false) await handOver({ trip, order, driver: std.DR1, cylinders: given });
  const stopId = trip.deliveryStopFor(order.id);

  for (const back of opts.takenBack ?? []) {
    const [old] = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes[back.size], count: 1 });
    await placeWithCustomer({ cylinder: old, client, actor: std.DR2, at: new Date(Date.now() - 86_400_000) });
    await takeBack({ trip, order, driver: std.DR1, cylinders: [old], returnState: back.state });
  }
  const unlabelled = opts.unlabelled ?? [
    { size: 'kg11_8', state: 'EMPTY', count: 1 },
    { size: 'kg11_8', state: 'PART_FILLED', count: 1 },
  ];
  for (const row of unlabelled) {
    await db.stopUnlabelledReturn.create({
      data: { tripStopId: stopId, orderId: order.id, cylinderTypeId: std.sizes[row.size], state: row.state, count: row.count, recordedByUserId: std.DR1.userId },
    });
  }

  const delivery: X1Delivery = { order, trip, stopId, given, issued: null, confirmationId: null, token: null };
  if (opts.deliver === false) return delivery;
  return finishDelivery(app, delivery, std.DR1.userId);
}

/**
 * Delivers an order as the visit finish does (API_CONTRACT §9.3, DATA_MODEL §4.5): one transaction sets
 * the order DELIVERED (SCANNED) and the stop DONE and issues the confirmation; the SMS is sent after
 * commit (awaited here, so a test reads the row's final state).
 */
export async function finishDelivery(
  app: INestApplication,
  delivery: X1Delivery,
  deliveredByUserId: string,
  method: DeliveryMethod = DeliveryMethod.SCANNED,
): Promise<X1Delivery> {
  const prisma = app.get(PrismaService);
  const confirmations = app.get(ConfirmationService);
  const deliveredAt = new Date();
  const issued = await prisma.$transaction(async (tx) => {
    const moved = await tx.order.updateMany({
      where: { id: delivery.order.id, deliveredAt: null, status: { in: [OrderStatus.ASSIGNED, OrderStatus.IN_TRANSIT] } },
      data: { status: OrderStatus.DELIVERED, deliveredAt, deliveredByUserId, deliveryMethod: method },
    });
    if (moved.count !== 1) throw new Error(`order ${delivery.order.shortCode} can't be delivered now`);
    await tx.$executeRaw`
      UPDATE trip_stops SET status = 'DONE', departed_at = COALESCE(departed_at, ${deliveredAt}), completed_at = ${deliveredAt}
      WHERE id = ${delivery.stopId}::uuid`;
    return confirmations.issueForDeliveredOrder(tx, { orderId: delivery.order.id, stopId: delivery.stopId, deliveredAt });
  });
  await confirmations.sendIssued(issued);
  const row = await getTestPrisma().deliveryConfirmation.findUnique({ where: { orderId: delivery.order.id }, select: { id: true, tokenVersion: true } });
  return {
    ...delivery,
    issued,
    confirmationId: row?.id ?? null,
    token: row ? confirmationToken(row.id, row.tokenVersion) : null,
  };
}

/** The current link token of an order's confirmation. */
export async function currentToken(orderId: string): Promise<string> {
  const row = await getTestPrisma().deliveryConfirmation.findUniqueOrThrow({ where: { orderId }, select: { id: true, tokenVersion: true } });
  return confirmationToken(row.id, row.tokenVersion);
}

// ---------- reads ----------

export async function confirmationOf(orderId: string) {
  return getTestPrisma().deliveryConfirmation.findUnique({ where: { orderId } });
}

export async function messagesOf(orderId: string) {
  return getTestPrisma().outboundMessage.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

export async function auditRows(action: string, resourceId?: string) {
  return getTestPrisma().auditLog.findMany({ where: { action, ...(resourceId ? { resourceId } : {}) }, orderBy: { createdAt: 'asc' } });
}

export async function casesOf(orderId?: string) {
  return getTestPrisma().alert.findMany({
    where: { alertType: 'CUSTOMER_PROBLEM', ...(orderId ? { resourceId: orderId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
}

/** DA's money: the balance and the ledger rows (no confirmation step may change either). */
export async function moneyOf(distributorId: string) {
  const db = getTestPrisma();
  const distributor = await db.distributor.findUniqueOrThrow({ where: { id: distributorId }, select: { advanceBalancePaisa: true } });
  const ledger = await db.ledgerEntry.findMany({ where: { distributorId }, orderBy: { createdAt: 'asc' }, select: { id: true, entryType: true, amountPaisa: true } });
  return { balancePaisa: distributor.advanceBalancePaisa, ledger };
}

/** Waits until no message row is QUEUED any more (the after-commit sends ran). */
export async function waitForSends(timeoutMs = 10_000): Promise<void> {
  const db = getTestPrisma();
  const until = Date.now() + timeoutMs;
  while ((await db.outboundMessage.count({ where: { status: 'QUEUED' } })) > 0) {
    if (Date.now() > until) throw new Error('a message stayed QUEUED');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Moves a link in time as if it had been delivered earlier: `expiresAt` becomes the given moment and the
 * delivery (the order's `delivered_at` and the snapshot's `deliveredAt`) moves with it, so the link keeps
 * its own lifetime (the expired page states it).
 */
export async function ageLink(orderId: string, expiresAt: Date): Promise<void> {
  const db = getTestPrisma();
  const row = await db.deliveryConfirmation.findUniqueOrThrow({ where: { orderId }, select: { expiresAt: true, snapshot: true } });
  const snapshot = row.snapshot as { deliveredAt: string };
  const lifetimeMs = row.expiresAt.getTime() - new Date(snapshot.deliveredAt).getTime();
  const deliveredAt = new Date(expiresAt.getTime() - lifetimeMs);
  await db.deliveryConfirmation.update({
    where: { orderId },
    data: { expiresAt, snapshot: { ...(row.snapshot as object), deliveredAt: deliveredAt.toISOString() } as Prisma.InputJsonValue },
  });
  await db.order.update({ where: { id: orderId }, data: { deliveredAt } });
}

/** Sets a confirmation's fields directly (fixtures: expired, cancelled, answered). */
export async function patchConfirmation(orderId: string, data: Prisma.DeliveryConfirmationUpdateInput): Promise<void> {
  await getTestPrisma().deliveryConfirmation.update({ where: { orderId }, data });
}

// ---------- the public page ----------

let ipSeq = 0;
/** A fresh client IP per call (trust proxy 1 reads X-Forwarded-For), so the per-IP limits never mix tests. */
export function freshIp(): string {
  ipSeq += 1;
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${(ipSeq & 255) || 1}`;
}

export interface PageCallOptions {
  ip?: string;
  userAgent?: string;
}

/** Calls to `/c/…` as a browser makes them, each from its own IP unless one is given. */
export function pageCalls(app: INestApplication) {
  const api = http(app);
  const from = (req: TestRequest, opts: PageCallOptions = {}) => {
    let out = req.set('X-Forwarded-For', opts.ip ?? freshIp());
    if (opts.userAgent) out = out.set('User-Agent', opts.userAgent);
    return out;
  };
  return {
    /** `GET /c/<token><step>[?query]`. */
    get(token: string, step = '', opts: PageCallOptions & { query?: string } = {}): TestRequest {
      return from(api.get(`/c/${token}${step}${opts.query ? `?${opts.query}` : ''}`), opts);
    },
    /** A raw path under the API (`/c/…`, `/api/v1/c/…`). */
    path(method: 'get' | 'post' | 'put' | 'delete', path: string, opts: PageCallOptions = {}): TestRequest {
      return from(api[method](path), opts);
    },
    /** `POST /c/<token>` as the page's form sends it. Fields left out are not sent. */
    post(token: string, fields: Record<string, string>, opts: PageCallOptions = {}): TestRequest {
      const form = new URLSearchParams(fields);
      return from(api.post(`/c/${token}`), opts).set('Content-Type', 'application/x-www-form-urlencoded').send(form.toString());
    },
    /** `POST /c/<token>` with `v=1&answer=…` and an optional comment. */
    answer(token: string, answer: string, comment?: string, opts: PageCallOptions = {}): TestRequest {
      const fields: Record<string, string> = { v: '1', answer };
      if (comment !== undefined) fields.comment = comment;
      return this.post(token, fields, opts);
    },
  };
}

/** Deletes this run's page rate-limit windows (`<BULLMQ_PREFIX>:rl:confirm.page*`). */
export async function clearPageLimits(): Promise<void> {
  const prefix = process.env.BULLMQ_PREFIX || 'bull';
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:rl:confirm.page*`, 'COUNT', 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } catch {
    // No Redis: nothing was counted.
  } finally {
    redis.disconnect();
  }
}

/** The page text without tags, spaces collapsed: for "the page says …" checks. */
export function textOf(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- a provider spy ----------

/**
 * A "real" provider standing in for an SMS company: records every call and answers with `next` (a
 * result, a function, or a promise the test resolves later). Named `mock` unless told otherwise, so the
 * SMS rows read as the cases expect.
 */
export class SpyProvider implements MessagingProvider {
  readonly calls: OutboundRequest[] = [];
  next: SendResult | ((req: OutboundRequest) => Promise<SendResult> | SendResult) = { kind: 'SKIPPED', reason: 'MOCK_PROVIDER' };
  private readonly mock = new MockMessagingProvider();

  constructor(readonly name = 'mock') {}

  supports(): boolean {
    return true;
  }

  async send(req: OutboundRequest): Promise<SendResult> {
    this.calls.push(req);
    if (typeof this.next === 'function') return this.next(req);
    if (this.next.kind === 'SKIPPED' && this.next.reason === 'MOCK_PROVIDER') return this.mock.send(req);
    return this.next;
  }

  reset(): void {
    this.calls.length = 0;
    this.next = { kind: 'SKIPPED', reason: 'MOCK_PROVIDER' };
  }
}

/** createConfirmApp with `spy` as the live provider (behind test mode). */
export function withSpyProvider(spy: MessagingProvider) {
  return (builder: TestingModuleBuilder) => builder.overrideProvider(MESSAGING_PROVIDER).useValue(spy);
}

/** The messaging service of an app (to shorten the provider's time limit in a test). */
export function messagingOf(app: INestApplication): MessagingServiceImpl {
  return app.get(MessagingServiceImpl);
}
