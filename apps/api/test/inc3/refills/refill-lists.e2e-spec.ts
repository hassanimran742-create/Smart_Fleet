/**
 * [Inc 3, review23 contract-compat-06 / robustness-jobs-05] The refill lists (API_CONTRACT §1.3, §7.11,
 * §10.5):
 * - the office's Refills page reads one tab at a time, `GET /filling-orders?tab&q&distributorId&driverId&
 *   limit&cursor`, each tab its own cursor list with every tab's size (the Orders board's shape);
 * - the bare arrays (`GET /filling-orders` without a tab, `/mine`, `/driver/mine`) keep every open refill,
 *   however old, plus the newest 200 done or cancelled ones.
 * A refill waiting for a driver never drops off while the Today card still counts it. No money.
 */
import type { INestApplication } from '@nestjs/common';
import { FillingOrderStatus } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { authHeader, type TestActor } from '../../helpers/auth';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createRefill, createStation, type TestRefill } from '../../helpers/refills';
import { createStandardData, type StandardData } from '../../helpers/standard-data';

jest.setTimeout(300_000);

const DAY_MS = 86_400_000;

interface Row {
  id: string;
  shortCode: string;
  status: string;
  createdAt: string;
}

describeDb('inc3 refills: the office tabs and the bare-array lists', () => {
  let app: INestApplication;
  let std: StandardData;
  let refills: {
    oldWaiting: TestRefill;
    bgWaiting: TestRefill;
    assigned: TestRefill;
    filled: TestRefill;
    oldCancelled: TestRefill;
    done: TestRefill[];
  };

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb();
    std = await createStandardData();
    const station = await createStation();
    const now = Date.now();
    const at = (daysAgo: number, hours = 0) => new Date(now - daysAgo * DAY_MS + hours * 3_600_000);
    const base = { cylinderTypeId: std.sizes.kg11_8, requestedCount: 2, station };
    const oldCancelled = await createRefill({ ...base, distributor: std.DA, status: FillingOrderStatus.CANCELLED, createdAt: at(50) });
    const oldWaiting = await createRefill({ ...base, distributor: std.DA, createdAt: at(40) });
    const assigned = await createRefill({ ...base, distributor: std.DA, assignTo: std.DR1, createdAt: at(30) });
    const filled = await createRefill({ ...base, distributor: std.DA, assignTo: std.DR2, status: FillingOrderStatus.FILLED, createdAt: at(25) });
    const bgWaiting = await createRefill({ ...base, distributor: std.DB, createdAt: at(10) });
    const done: TestRefill[] = [];
    for (let i = 0; i < 201; i++) {
      done.push(
        await createRefill({ ...base, distributor: i % 2 ? std.DA : std.DB, status: FillingOrderStatus.COMPLETED, createdAt: at(20, i) }),
      );
    }
    refills = { oldWaiting, bgWaiting, assigned, filled, oldCancelled, done };
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  const get = (caller: TestActor, url: string, query: Record<string, unknown> = {}) => http(app).get(`/api/v1${url}`).query(query).set(authHeader(caller));
  const ids = (rows: Row[]) => rows.map((row) => row.id);

  it('REV23 contract-compat-06 each tab is its own list: the oldest refill waiting for a driver comes first, with every tab\'s size', async () => {
    const page = await get(std.SA1.actor, '/filling-orders', { tab: 'needs-driver' }).expect(200);
    expect(page.body.counts).toEqual({ needsDriver: 2, inProgress: 2, done: 201, cancelled: 1 });
    expect(ids(page.body.items)).toEqual([refills.oldWaiting.id, refills.bgWaiting.id]);
    expect(page.body.nextCursor).toBeNull();
    expect(page.body.items[0]).toMatchObject({ shortCode: 'AG-R002', status: 'PENDING', stage: 'NEEDS_DRIVER', allowedActions: ['ASSIGN'] });
    // The Today card counts the same refills.
    const today = await get(std.SA1.actor, '/admin/summary').expect(200);
    expect(today.body.refills.needsDriver).toBe(page.body.counts.needsDriver);

    const inProgress = await get(std.SA1.actor, '/filling-orders', { tab: 'in-progress' }).expect(200);
    expect(ids(inProgress.body.items)).toEqual([refills.filled.id, refills.assigned.id]);
    const cancelled = await get(std.SA1.actor, '/filling-orders', { tab: 'cancelled' }).expect(200);
    expect(ids(cancelled.body.items)).toEqual([refills.oldCancelled.id]);
  });

  it('REV23 robustness-jobs-05 the done tab pages newest first with a cursor, and a cursor belongs to its tab', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(std.SA1.actor, '/filling-orders', { tab: 'done', limit: 100, ...(cursor ? { cursor } : {}) }).expect(200);
      seen.push(...ids(res.body.items));
      cursor = res.body.nextCursor;
      pages += 1;
      if (pages === 1) {
        expect(res.body.items).toHaveLength(100);
        const other = await get(std.SA1.actor, '/filling-orders', { tab: 'in-progress', cursor });
        expect({ status: other.status, code: other.body.code, path: other.body.details?.fields?.[0]?.path }).toEqual({
          status: 400,
          code: 'VALIDATION_FAILED',
          path: 'cursor',
        });
      }
    } while (cursor && pages < 5);
    expect(pages).toBe(3);
    expect(seen).toEqual([...refills.done].reverse().map((refill) => refill.id));
    expect((await get(std.SA1.actor, '/filling-orders', { tab: 'done', limit: 101 })).status).toBe(400);
    expect((await get(std.SA1.actor, '/filling-orders', { tab: 'later' })).status).toBe(400);
  });

  it('REV23 contract-compat-06 the search finds a refill by its number or its distributor, and the filters narrow the counts', async () => {
    const byName = await get(std.SA1.actor, '/filling-orders', { tab: 'needs-driver', q: 'bilal' }).expect(200);
    expect(ids(byName.body.items)).toEqual([refills.bgWaiting.id]);
    expect(byName.body.counts).toEqual({ needsDriver: 2, inProgress: 2, done: 201, cancelled: 1 });
    const byNumber = await get(std.SA1.actor, '/filling-orders', { tab: 'needs-driver', q: 'ag-r002' }).expect(200);
    expect(ids(byNumber.body.items)).toEqual([refills.oldWaiting.id]);
    const bareNumber = await get(std.SA1.actor, '/filling-orders', { tab: 'needs-driver', q: 'R002' }).expect(200);
    expect(ids(bareNumber.body.items)).toEqual([refills.oldWaiting.id]);

    const bilal = await get(std.SA1.actor, '/filling-orders', { tab: 'needs-driver', distributorId: std.DB.id }).expect(200);
    expect(bilal.body.counts).toEqual({ needsDriver: 1, inProgress: 0, done: 101, cancelled: 0 });
    const kashif = await get(std.SA1.actor, '/filling-orders', { tab: 'in-progress', driverId: std.DR1.id }).expect(200);
    expect(ids(kashif.body.items)).toEqual([refills.assigned.id]);
    expect(kashif.body.counts).toEqual({ needsDriver: 0, inProgress: 1, done: 0, cancelled: 0 });
  });

  it('REV23 robustness-jobs-05 the bare arrays keep every open refill, however old, and the newest 200 closed ones', async () => {
    const office = await get(std.SA1.actor, '/filling-orders').expect(200);
    const rows = office.body as Row[];
    expect(Array.isArray(office.body)).toBe(true);
    const open = [refills.bgWaiting, refills.filled, refills.assigned, refills.oldWaiting].map((refill) => refill.id);
    expect(ids(rows).filter((id) => open.includes(id)).sort()).toEqual([...open].sort());
    expect(rows.filter((row) => row.status === 'COMPLETED' || row.status === 'CANCELLED')).toHaveLength(200);
    expect(ids(rows)).not.toContain(refills.oldCancelled.id);
    expect(ids(rows)).not.toContain(refills.done[0].id); // the oldest done refill is the 201st closed one
    // Newest first, whatever the status.
    const times = rows.map((row) => new Date(row.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // One status still filters the legacy array.
    const pending = await get(std.SA1.actor, '/filling-orders', { status: 'PENDING' }).expect(200);
    expect(ids(pending.body as Row[])).toEqual([refills.bgWaiting.id, refills.oldWaiting.id]);

    const shop = await get(std.DA.actor, '/filling-orders/mine').expect(200);
    expect(ids(shop.body as Row[])).toEqual(expect.arrayContaining([refills.oldWaiting.id, refills.assigned.id, refills.filled.id, refills.oldCancelled.id]));
    const driver = await get(std.DR1.actor, '/filling-orders/driver/mine').expect(200);
    expect(ids(driver.body as Row[])).toEqual([refills.assigned.id]);
  });
});
