/**
 * Review (robustness and operations): fuzz every Increment 1 body, query and path id with wrong types,
 * huge numbers, unicode, empty strings, NUL characters and nulls. Nothing a client sends may produce a
 * 5xx: bad input is a 4xx with the §2.1 envelope (API_CONTRACT §2.2).
 *
 * This suite records every 5xx and prints them, then fails if there are any. The targeted suites next to
 * it confirm each class of failure on its own.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import {
  authHeader,
  createDriver,
  createStandardData,
  createUser,
  describeDb,
  getTestPrisma,
  x1OrderBody,
  type StandardData,
  type TestActor,
} from '../../helpers';
import { http } from '../../helpers/http';
import { setCompanyAccount } from '../../money/money-fixtures';
import { UserRole } from '@prisma/client';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface Spec {
  name: string;
  method: Method;
  path: string;
  actor: TestActor | null;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  idempotent?: boolean;
}

interface Failure {
  spec: string;
  variant: string;
  status: number;
  code: string | undefined;
}

const LONG = 'x'.repeat(5000);
/** Values put in place of one field at a time. */
const FUZZ: Array<[string, unknown]> = [
  ['null', null],
  ['true', true],
  ['zero', 0],
  ['minus one', -1],
  ['half', 0.5],
  ['huge', 1e308],
  ['unsafe int', 9007199254740993],
  ['empty', ''],
  ['blank', '   '],
  ['NUL', '\u0000'],
  ['text with NUL', 'ab\u0000cd'],
  ['emoji', '😀🚚'.repeat(10)],
  ['rtl', '‮اردو متن'],
  ['long', LONG],
  ['digit string 20', '99999999999999999999'],
  ['exp string', '1e3'],
  ['array', []],
  ['array of one', ['a']],
  ['object', {}],
  ['object nested', { a: { b: 1 } }],
  ['year zero', '0000-01-01T00:00:00Z'],
  ['far future', '9999-12-31T23:59:59Z'],
  ['bad date', '2026-02-30'],
  ['sql', "' OR 1=1 --"],
];

/** Whole-body replacements. */
const BODIES: Array<[string, unknown]> = [
  ['no body', undefined],
  ['array body', []],
  ['array of objects', [{}]],
  ['deep nesting', JSON.parse('['.repeat(2000) + ']'.repeat(2000))],
];

/** Path ids on routes that take one. */
const IDS: Array<[string, string]> = [
  ['not a uuid', 'not-a-uuid'],
  ['nil uuid', '00000000-0000-0000-0000-000000000000'],
  ['NUL', '%00'],
  ['long', 'a'.repeat(300)],
  ['unicode', encodeURIComponent('😀')],
];

function setPath(body: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  let node: Record<string, unknown> = copy;
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
  return copy;
}

function fieldPaths(body: Record<string, unknown>, prefix: string[] = []): string[][] {
  const out: string[][] = [];
  for (const [key, value] of Object.entries(body)) {
    const path = [...prefix, key];
    out.push(path);
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...fieldPaths(value as Record<string, unknown>, path));
    if (Array.isArray(value) && value[0] && typeof value[0] === 'object') {
      out.push(...fieldPaths(value[0] as Record<string, unknown>, [...path, '0']));
    }
  }
  return out;
}

let keyCounter = 0;
function freshKey(): string {
  keyCounter += 1;
  return `cccccccc-cccc-4ccc-8ccc-${String(keyCounter).padStart(12, '0')}`;
}

describeDb('review robustness: fuzzing Inc 1 inputs never gives a 5xx', () => {
  let app: INestApplication;
  let std: StandardData;
  const failures: Failure[] = [];
  let sent = 0;

  async function send(spec: Spec, variant: string, body: unknown, query?: Record<string, string>, path?: string): Promise<void> {
    const api = http(app);
    let req = api[spec.method](`/api/v1${path ?? spec.path}`);
    if (spec.actor) req = req.set(authHeader(spec.actor));
    if (spec.idempotent) req = req.set('Idempotency-Key', freshKey());
    if (query ?? spec.query) req = req.query(query ?? spec.query ?? {});
    if (body !== undefined) req = req.send(body);
    const res = await req;
    sent += 1;
    if (res.status >= 500) failures.push({ spec: spec.name, variant, status: res.status, code: res.body?.code });
  }

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData({ cylinders: true });
    await setCompanyAccount(app);
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('records no 5xx for any fuzzed body, query or id', async () => {
    const db = getTestPrisma();
    const SA = std.SA1.actor;
    const DA = std.DA.actor;
    const DR = std.DR1.actor;

    // Resources the routes act on.
    const order = await http(app).post('/api/v1/orders').set(authHeader(DA)).set('Idempotency-Key', freshKey()).send(x1OrderBody(std));
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;
    const topup = await http(app)
      .post('/api/v1/payments/topup-requests')
      .set(authHeader(DA))
      .set('Idempotency-Key', freshKey())
      .send({ amountPaisa: 100000, payerName: 'Ahmed', payerChannel: 'BANK_APP' });
    expect(topup.status).toBe(201);
    const paymentId = topup.body.id as string;
    const petrol = await db.expenseType.findFirstOrThrow({ where: { code: 'PETROL' } });
    const expense = await http(app)
      .post('/api/v1/expenses')
      .set(authHeader(SA))
      .set('Idempotency-Key', freshKey())
      .send({ expenseDate: '2026-10-01', amountPaisa: 50000, typeId: petrol.id, description: 'Fuel' });
    expect(expense.status).toBe(201);
    const expenseId = expense.body.id as string;
    // Throwaway targets for office actions that would otherwise sign the standard people out.
    const spareDriver = await createDriver({ zone: std.zones.North });
    const spareUser = await createUser({ role: UserRole.DRIVER });
    const store = await db.store.findFirstOrThrow({ where: { id: std.DA.homeStoreId } });

    const specs: Spec[] = [
      // Public and auth
      { name: 'POST /auth/login', method: 'post', path: '/auth/login', actor: null, body: { phone: '03211234567', password: 'secret123' } },
      { name: 'POST /auth/refresh', method: 'post', path: '/auth/refresh', actor: null, body: { refreshToken: 'x'.repeat(40) } },
      { name: 'POST /auth/change-password', method: 'post', path: '/auth/change-password', actor: DR, body: { currentPassword: 'a', newPassword: 'abcdefgh1' } },
      // Distributor
      { name: 'POST /clients', method: 'post', path: '/clients', actor: DA, idempotent: true, body: { name: 'Zara', phone: '0300 5550001', address: { label: 'Home', lat: 31.53, lng: 74.23 }, area: 'Gulberg', notes: 'n' } },
      { name: 'POST /clients/:id/addresses', method: 'post', path: `/clients/${std.C1.id}/addresses`, actor: DA, body: { label: 'Shop', lat: 31.53, lng: 74.23 } },
      { name: 'POST /orders/quote', method: 'post', path: '/orders/quote', actor: DA, body: x1OrderBody(std) },
      { name: 'POST /orders', method: 'post', path: '/orders', actor: DA, idempotent: true, body: { ...x1OrderBody(std), quotedTotalPaisa: '48000', scheduledWindowStart: '2026-10-23T10:00:00Z', scheduledWindowEnd: '2026-10-23T12:00:00Z', note: 'ring' } },
      { name: 'POST /orders (pin)', method: 'post', path: '/orders', actor: DA, idempotent: true, body: { clientId: std.C1.id, deliveryLocation: { lat: 31.53, lng: 74.23 }, deliveryLabel: 'Gate', lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }] } },
      { name: 'POST /orders/:id/cancel (shop)', method: 'post', path: `/orders/${orderId}/cancel`, actor: DA, idempotent: true, body: { reasonCode: 'WRONG_ORDER', note: 'oops', confirmRefundPaisa: '0' } },
      { name: 'POST /payments/topup-requests', method: 'post', path: '/payments/topup-requests', actor: DA, idempotent: true, body: { amountPaisa: 100000, payerName: 'Ahmed', payerChannel: 'BANK_APP', transactionId: 'TX-1', proofFileId: '00000000-0000-4000-8000-000000000000' } },
      { name: 'POST /payments/topup', method: 'post', path: '/payments/topup', actor: DA, body: { amountPaisa: 100000, provider: 'BANK_MANUAL' } },
      { name: 'POST /payments/:id/bank-proof', method: 'post', path: `/payments/${paymentId}/bank-proof`, actor: DA, body: { proofUrl: 'uploads/2026-10-22/x.jpg' } },
      { name: 'POST /filling-orders', method: 'post', path: '/filling-orders', actor: DA, body: { fillingStationId: '00000000-0000-4000-8000-000000000000', cylinderTypeId: std.sizes.kg11_8, requestedCount: 2 } },
      { name: 'PATCH /users/me', method: 'patch', path: '/users/me', actor: DA, body: { name: 'Ahmed', email: 'a@b.pk' } },
      // Driver
      { name: 'PATCH /orders/:id/status (driver)', method: 'patch', path: `/orders/${orderId}/status`, actor: DR, body: { status: 'DELIVERED', reason: 'r', reasonCode: 'OTHER' } },
      { name: 'POST /orders/:id/fail (driver)', method: 'post', path: `/orders/${orderId}/fail`, actor: DR, body: { reasonCode: 'OTHER', note: 'not home', lat: 31.5, lng: 74.2 } },
      { name: 'POST /custody/scan', method: 'post', path: '/custody/scan', actor: DR, body: { qrCode: 'AG-C0001-QR', eventType: 'SCAN_OUT', tripId: '00000000-0000-4000-8000-000000000000', orderId, lat: 31.5, lng: 74.2 } },
      { name: 'PATCH /drivers/:id/location', method: 'patch', path: `/drivers/${std.DR1.id}/location`, actor: DR, body: { lat: 31.5, lng: 74.2 } },
      { name: 'PATCH /drivers/:id/online', method: 'patch', path: `/drivers/${std.DR1.id}/online`, actor: DR, body: { isOnline: true } },
      { name: 'PATCH /drivers/:id/profile (self)', method: 'patch', path: `/drivers/${std.DR1.id}/profile`, actor: DR, body: { name: 'Kashif', profilePictureUrl: 'https://x/y.jpg' } },
      // Office
      { name: 'POST /distributors', method: 'post', path: '/distributors', actor: SA, idempotent: true, body: { phone: '0333 5550002', name: 'Noor', businessName: 'Noor Gas', code: 'NG', cnic: '35202-7654321-3', email: 'n@g.pk', store: { name: 'Noor store', address: 'Main road', lat: 31.52, lng: 74.22 } } },
      { name: 'PATCH /distributors/:id', method: 'patch', path: `/distributors/${std.DB.id}`, actor: SA, body: { businessName: 'Bilal Gas', name: 'Bilal', email: 'b@g.pk' } },
      { name: 'PATCH /distributors/:id/store', method: 'patch', path: `/distributors/${std.DB.id}/store`, actor: SA, body: { name: 'Store', address: 'Road', lat: 31.52, lng: 74.28 } },
      { name: 'PATCH /distributors/:id/code', method: 'patch', path: `/distributors/${std.DB.id}/code`, actor: SA, body: { code: 'BG' } },
      { name: 'PUT /pricing/prices', method: 'put', path: `/pricing/prices/${std.DA.id}/${std.zones.East.id}`, actor: SA, body: { basePaisa: 10000, sizes: [{ cylinderTypeId: std.sizes.kg6, perCylinderPaisa: 1000 }], note: 'n' } },
      { name: 'DELETE /pricing/prices', method: 'delete', path: `/pricing/prices/${std.DB.id}/${std.zones.East.id}`, actor: SA, body: { reason: 'not served' } },
      { name: 'POST /orders/:id/assign-driver', method: 'post', path: `/orders/${orderId}/assign-driver`, actor: SA, body: { driverId: spareDriver.id, reason: 'r' } },
      { name: 'POST /orders/:id/manual-delivery', method: 'post', path: `/orders/${orderId}/manual-delivery`, actor: SA, body: { reason: 'forgotten in scan' } },
      { name: 'POST /orders/:id/cancel (office)', method: 'post', path: `/orders/${orderId}/cancel`, actor: SA, body: { reasonCode: 'OTHER', note: 'office note' } },
      { name: 'POST /orders/:id/fail (office)', method: 'post', path: `/orders/${orderId}/fail`, actor: SA, body: { reasonCode: 'OTHER', note: 'office note' } },
      { name: 'PATCH /orders/:id/status (office)', method: 'patch', path: `/orders/${orderId}/status`, actor: SA, body: { status: 'CONFIRMED' } },
      { name: 'POST /payments/:id/approve', method: 'post', path: `/payments/${paymentId}/approve`, actor: SA, body: { bankReference: 'FT-1', bankAmountPaisa: 1000, bankTime: '2026-10-01T10:00:00Z' } },
      { name: 'POST /payments/:id/reject', method: 'post', path: `/payments/${paymentId}/reject`, actor: SA, body: { reasonCode: 'OTHER', note: 'n' } },
      { name: 'POST /payments/:id/verify', method: 'post', path: `/payments/${paymentId}/verify`, actor: SA, body: { approve: true } },
      { name: 'POST wallet corrections', method: 'post', path: `/admin/distributors/${std.DB.id}/wallet/corrections`, actor: SA, idempotent: true, body: { direction: 'ADD', amountPaisa: 10000, reasonCode: 'OTHER', note: 'a test correction', relatedPaymentId: paymentId, relatedOrderId: orderId } },
      { name: 'PATCH /settings/:key', method: 'patch', path: '/settings/wallet.lowBalancePaisa', actor: SA, body: { value: 100000, reason: 'review' } },
      { name: 'POST /expense-types', method: 'post', path: '/expense-types', actor: SA, body: { name: 'Snacks' } },
      { name: 'PATCH /expense-types/:id', method: 'patch', path: `/expense-types/${petrol.id}`, actor: SA, body: { name: 'Petrol' } },
      { name: 'POST /expenses', method: 'post', path: '/expenses', actor: SA, idempotent: true, body: { expenseDate: '2026-10-02', amountPaisa: 50000, typeId: petrol.id, vehicleId: std.DR1.vehicleId, driverId: std.DR1.id, description: 'Fuel', receiptFileId: '00000000-0000-4000-8000-000000000000' } },
      { name: 'PATCH /expenses/:id', method: 'patch', path: `/expenses/${expenseId}`, actor: SA, body: { expenseDate: '2026-10-02', amountPaisa: 50000, typeId: petrol.id, vehicleId: null, driverId: null, description: 'Fuel', receiptFileId: null } },
      { name: 'POST /expenses/:id/void', method: 'post', path: `/expenses/${expenseId}/void`, actor: SA, body: { reason: 'typed twice' } },
      { name: 'POST /drivers', method: 'post', path: '/drivers', actor: SA, body: { name: 'Imran', phone: '0345 5550003', licenceNo: 'LIC-9', email: 'i@d.pk', cnic: '35202-1234567-1', profilePictureUrl: 'https://x/y.jpg' } },
      { name: 'PATCH /drivers/:id/profile (office)', method: 'patch', path: `/drivers/${spareDriver.id}/profile`, actor: SA, body: { name: 'N', email: 'e@x.pk', cnic: '35202-1234567-2', licenceNo: 'LIC-10', profilePictureUrl: 'https://x/z.jpg' } },
      { name: 'PATCH /drivers/:id/vehicle', method: 'patch', path: `/drivers/${spareDriver.id}/vehicle`, actor: SA, body: { vehicleId: spareDriver.vehicleId } },
      { name: 'PATCH /drivers/:id/availability', method: 'patch', path: `/drivers/${spareDriver.id}/availability`, actor: SA, body: { availability: 'ON_LEAVE', leaveStart: '2026-10-25', leaveEnd: '2026-10-26', reason: 'r' } },
      { name: 'PATCH /users/:id/status', method: 'patch', path: `/users/${spareUser.id}/status`, actor: SA, body: { value: 'ACTIVE', reason: 'review test' } },
      { name: 'POST /users/:id/password', method: 'post', path: `/users/${spareUser.id}/password`, actor: SA, body: { password: 'abcdefgh12' } },
      { name: 'POST /zones', method: 'post', path: '/zones', actor: SA, body: { cityId: std.zones.North.cityId, name: 'West', polygonGeoJson: { type: 'MultiPolygon', coordinates: [[[[74.1, 31.5], [74.15, 31.5], [74.15, 31.55], [74.1, 31.55], [74.1, 31.5]]]] } } },
      { name: 'PATCH /zones/:id', method: 'patch', path: `/zones/${std.zones.East.id}`, actor: SA, body: { name: 'East' } },
      { name: 'POST /stores', method: 'post', path: '/stores', actor: SA, body: { name: 'Spare store', address: 'Road', lat: 31.52, lng: 74.22 } },
      { name: 'PATCH /stores/:id', method: 'patch', path: `/stores/${store.id}`, actor: SA, body: { name: store.name } },
      { name: 'POST /cities', method: 'post', path: '/cities', actor: SA, body: { name: 'Multan', countryCode: 'PK' } },
      { name: 'POST /cylinder-types', method: 'post', path: '/cylinder-types', actor: SA, body: { code: 'X1', name: 'X', weightKg: 1, capacityUnits: 1 } },
      { name: 'POST /cylinders/bulk-register', method: 'post', path: '/cylinders/bulk-register', actor: SA, body: { distributorId: std.DB.id, cylinderTypeId: std.sizes.kg6, quantity: 1, state: 'FULL' } },
      { name: 'PATCH /trips/:id/status', method: 'patch', path: '/trips/00000000-0000-4000-8000-000000000000/status', actor: SA, body: { status: 'ABORTED', reason: 'abort it' } },
    ];

    for (const spec of specs) {
      if (spec.body) {
        for (const path of fieldPaths(spec.body)) {
          for (const [label, value] of FUZZ) {
            await send(spec, `${path.join('.')}=${label}`, setPath(spec.body, path, value));
          }
        }
      }
      for (const [label, body] of BODIES) await send(spec, label, body);
    }

    // Query strings of the Inc 1 lists.
    const lists: Spec[] = [
      { name: 'GET /orders', method: 'get', path: '/orders', actor: DA, query: { tab: 'active', limit: '30', cursor: '' } },
      { name: 'GET /orders/board', method: 'get', path: '/orders/board', actor: SA, query: { tab: 'all', q: 'Sana', distributorId: std.DA.id, limit: '30' } },
      { name: 'GET /wallet/statement', method: 'get', path: '/wallet/statement', actor: DA, query: { kind: 'DELIVERY_COST', from: '2026-10-01', to: '2026-10-30', limit: '30' } },
      { name: 'GET admin statement', method: 'get', path: `/admin/distributors/${std.DA.id}/wallet/statement`, actor: SA, query: { kind: 'DELIVERY_COST', from: '2026-10-01', to: '2026-10-30' } },
      { name: 'GET /admin/topups', method: 'get', path: '/admin/topups', actor: SA, query: { tab: 'all', q: 'Ahmed', limit: '30' } },
      { name: 'GET /expenses', method: 'get', path: '/expenses', actor: SA, query: { from: '2026-10-01', to: '2026-10-30', typeId: petrol.id, includeVoided: 'true' } },
      { name: 'GET /expenses/summary', method: 'get', path: '/expenses/summary', actor: SA, query: { from: '2026-10-01', to: '2026-10-30' } },
      { name: 'GET /audit-logs', method: 'get', path: '/audit-logs', actor: SA, query: { resourceType: 'order', action: 'order.create', from: '2026-10-01', to: '2026-10-30' } },
      { name: 'GET /pricing/quote', method: 'get', path: '/pricing/quote', actor: DA, query: { lat: '31.53', lng: '74.23' } },
      { name: 'GET /clients (office)', method: 'get', path: '/clients', actor: SA, query: { distributorId: std.DA.id } },
      { name: 'GET /orders/all', method: 'get', path: '/orders/all', actor: SA, query: { status: 'PENDING' } },
      { name: 'GET /filling-orders', method: 'get', path: '/filling-orders', actor: SA, query: { status: 'PENDING', driverId: std.DR1.id } },
      { name: 'GET /cylinders', method: 'get', path: '/cylinders', actor: SA, query: { distributorId: std.DA.id } },
      { name: 'GET /payments', method: 'get', path: '/payments', actor: SA, query: { status: 'PENDING' } },
      { name: 'GET /reports/delivery-funnel', method: 'get', path: '/reports/delivery-funnel', actor: SA, query: { since: '2026-10-01' } },
      { name: 'GET /zones/locate', method: 'get', path: '/zones/locate', actor: DA, query: { lat: '31.53', lng: '74.23' } },
      { name: 'GET /filling-stations/nearby', method: 'get', path: '/filling-stations/nearby', actor: DA, query: { lat: '31.53', lng: '74.23', radiusKm: '5' } },
      { name: 'GET /users', method: 'get', path: '/users', actor: SA, query: { role: 'DRIVER' } },
    ];
    const QUERY_FUZZ: Array<[string, string]> = [
      ['empty', ''],
      ['NUL', '\u0000'],
      ['long', LONG],
      ['negative', '-1'],
      ['huge', '1e309'],
      ['word', 'abc'],
      ['emoji', '😀'],
      ['cursor junk', 'WyJ4Il0'],
      ['cursor old date', Buffer.from(JSON.stringify(['-271821-04-20T00:00:00.000Z', '00000000-0000-4000-8000-000000000000'])).toString('base64url')],
      ['cursor year 0', Buffer.from(JSON.stringify(['0000-01-01T00:00:00.000Z', '00000000-0000-4000-8000-000000000000'])).toString('base64url')],
      ['date year 0', '0000-01-01T00:00:00Z'],
      ['date far', '9999-12-31'],
    ];
    for (const spec of lists) {
      const keys = [...Object.keys(spec.query ?? {}), 'cursor', 'limit'];
      for (const keyName of new Set(keys)) {
        for (const [label, value] of QUERY_FUZZ) {
          await send(spec, `?${keyName}=${label}`, undefined, { ...(spec.query ?? {}), [keyName]: value });
        }
        // An array and an object where a single value is expected (qs extended parsing).
        await send(spec, `?${keyName}[]`, undefined, { ...(spec.query ?? {}), [`${keyName}[]`]: 'a' });
        await send(spec, `?${keyName}[x]`, undefined, { ...(spec.query ?? {}), [`${keyName}[x]`]: 'a' });
      }
    }

    // Path ids.
    const idRoutes: Array<{ name: string; method: Method; path: (id: string) => string; actor: TestActor; body?: unknown }> = [
      { name: 'GET /orders/:id', method: 'get', path: (id) => `/orders/${id}`, actor: DA },
      { name: 'GET /orders/:id/tracking', method: 'get', path: (id) => `/orders/${id}/tracking`, actor: DA },
      { name: 'GET /payments/:id', method: 'get', path: (id) => `/payments/${id}`, actor: DA },
      { name: 'POST /payments/:id/approve', method: 'post', path: (id) => `/payments/${id}/approve`, actor: SA, body: { bankReference: 'FT-1', bankAmountPaisa: 100000, bankTime: '2026-10-01T10:00:00Z' } },
      { name: 'POST /payments/:id/reject', method: 'post', path: (id) => `/payments/${id}/reject`, actor: SA, body: { reasonCode: 'NOT_IN_BANK' } },
      { name: 'GET /drivers/:id', method: 'get', path: (id) => `/drivers/${id}`, actor: SA },
      { name: 'PATCH /drivers/:id/location', method: 'patch', path: (id) => `/drivers/${id}/location`, actor: DR, body: { lat: 31.5, lng: 74.2 } },
      { name: 'DELETE /drivers/:id', method: 'delete', path: (id) => `/drivers/${id}`, actor: SA, body: { reason: 'leaving us' } },
      { name: 'GET /users/:id', method: 'get', path: (id) => `/users/${id}`, actor: SA },
      { name: 'PATCH /users/:id/status', method: 'patch', path: (id) => `/users/${id}/status`, actor: SA, body: { value: 'SUSPENDED', reason: 'review test' } },
      { name: 'POST /users/:id/password', method: 'post', path: (id) => `/users/${id}/password`, actor: SA, body: { password: 'abcdefgh12' } },
      { name: 'GET admin wallet', method: 'get', path: (id) => `/admin/distributors/${id}/wallet`, actor: SA },
      { name: 'GET admin statement', method: 'get', path: (id) => `/admin/distributors/${id}/wallet/statement`, actor: SA },
      { name: 'POST wallet corrections', method: 'post', path: (id) => `/admin/distributors/${id}/wallet/corrections`, actor: SA, body: { direction: 'ADD', amountPaisa: 10000, reasonCode: 'OTHER', note: 'a test correction' } },
      { name: 'PATCH /expenses/:id', method: 'patch', path: (id) => `/expenses/${id}`, actor: SA, body: { description: 'x' } },
      { name: 'POST /expenses/:id/void', method: 'post', path: (id) => `/expenses/${id}/void`, actor: SA, body: { reason: 'typed twice' } },
      { name: 'PATCH /expense-types/:id', method: 'patch', path: (id) => `/expense-types/${id}`, actor: SA, body: { name: 'Snacks 2' } },
      { name: 'POST /expense-types/:id/archive', method: 'post', path: (id) => `/expense-types/${id}/archive`, actor: SA },
      { name: 'GET /files/:id/url', method: 'get', path: (id) => `/files/${id}/url`, actor: DA },
      { name: 'GET /cylinders/by-qr/:qr', method: 'get', path: (id) => `/cylinders/by-qr/${id}`, actor: DA },
      { name: 'GET /vehicles/:id', method: 'get', path: (id) => `/vehicles/${id}`, actor: SA },
      { name: 'PATCH /settings/:key', method: 'patch', path: (id) => `/settings/${id}`, actor: SA, body: { value: 1, reason: 'review' } },
      { name: 'GET /inventory/store/:id', method: 'get', path: (id) => `/inventory/store/${id}`, actor: SA },
      { name: 'GET /alerts/:id ack', method: 'patch', path: (id) => `/alerts/${id}/acknowledge`, actor: SA },
      { name: 'GET /returns/store/:id/empties', method: 'get', path: (id) => `/returns/store/${id}/empties`, actor: SA },
      { name: 'GET /reports/orders-by-zone/:cityId', method: 'get', path: (id) => `/reports/orders-by-zone/${id}`, actor: SA },
    ];
    for (const route of idRoutes) {
      for (const [label, id] of IDS) {
        await send({ name: route.name, method: route.method, path: '', actor: route.actor }, `:id=${label}`, route.body, undefined, route.path(id));
      }
    }

    const summary = new Map<string, Failure[]>();
    for (const f of failures) summary.set(f.spec, [...(summary.get(f.spec) ?? []), f]);
    const lines = [...summary.entries()].map(([spec, list]) => `${spec}: ${list.length} x 5xx, e.g. ${list.slice(0, 6).map((f) => f.variant).join(' | ')}`);
    // eslint-disable-next-line no-console
    console.log(`[fuzz] ${sent} requests, ${failures.length} answered 5xx\n${lines.join('\n')}`);
    expect(failures).toEqual([]);
  }, 900_000);
});
