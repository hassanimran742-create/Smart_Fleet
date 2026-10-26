/**
 * EXP-011, EXP-012: the expense list (filters, order, the current month by default, cursor pages) and
 * the totals by type and by month, with the drivers' fuel logs counted beside them by Asia/Karachi
 * calendar month (ADR-14, ADR-21; API_CONTRACT §7.12, §1.3; UX_ADMIN §2.7). The clock is Thu 22 Oct
 * 2026 in Karachi.
 */
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getTestPrisma } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import type { StandardData } from '../helpers/standard-data';
import { BOOT_TIMEOUT_MS, createExpensesApp, expensesApi, freshStandardData, typeIds, type FixedClock } from './expense-kit';

interface Fixture {
  E1: string;
  E2: string;
  E3: string;
  E4: string;
  E5: string;
}

describeDb('expenses: list and totals', () => {
  let app: INestApplication;
  let clock: FixedClock;
  let std: StandardData;
  let types: Record<string, string>;
  let fx: Fixture;

  const api = () => expensesApi(app);
  const db = () => getTestPrisma();

  /** The EXP-011 fixture: E1–E4 live, E5 removed. */
  async function createFixture(): Promise<Fixture> {
    const lea101 = std.DR1.vehicleId as string;
    const leb202 = std.DR2.vehicleId as string;
    const add = async (expenseDate: string, typeId: string, amountPaisa: string, van: string | null, driver: string | null) => {
      const res = await api()
        .createExpense(std.SA1.actor, {
          expenseDate,
          typeId,
          amountPaisa,
          description: `Fixture ${expenseDate}`,
          ...(van ? { vehicleId: van } : {}),
          ...(driver ? { driverId: driver } : {}),
        })
        .expect(201);
      return res.body.id as string;
    };
    const E1 = await add('2026-09-28', types.PETROL, '200000', lea101, std.DR1.id);
    const E2 = await add('2026-10-01', types.PETROL, '250000', lea101, std.DR1.id);
    const E3 = await add('2026-10-05', types.MAINTENANCE, '120000', leb202, std.DR2.id);
    const E4 = await add('2026-10-10', types.TOLL_PARKING, '30000', null, null);
    const E5 = await add('2026-10-12', types.PETROL, '180000', leb202, std.DR2.id);
    await api().voidExpense(std.SA1.actor, E5, 'Entered twice').expect(200);
    return { E1, E2, E3, E4, E5 };
  }

  /** A driver's fuel log as the old driver app wrote it (fuel-refills.service.ts), straight into the table. */
  function fuelLog(at: string, costPaisa: bigint, van: string, driverId: string, odometerKm: number) {
    return db().fuelRefill.create({
      data: { vehicleId: van, driverId, litres: new Prisma.Decimal(20), costPaisa, odometerKm, refillAt: new Date(at) },
    });
  }

  const ids = (res: { body: { items: Array<{ id: string }> } }) => res.body.items.map((item) => item.id);

  beforeAll(async () => {
    ({ app, clock } = await createExpensesApp());
    std = await freshStandardData(app);
    types = await typeIds();
    fx = await createFixture();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  it('EXP-011 the expense list filters by type, van, driver and dates, newest first, with the current month by default', async () => {
    const { E1, E2, E3, E4, E5 } = fx;
    // Step 1: October by default; E5 is removed and E1 is in September.
    const october = await api().listExpenses(std.SA1.actor).expect(200);
    expect(ids(october)).toEqual([E4, E3, E2]);
    expect(october.body.nextCursor).toBeNull();

    const range = { from: '2026-09-01', to: '2026-10-31' };
    // Step 2.
    expect(ids(await api().listExpenses(std.SA1.actor, { ...range, typeId: types.PETROL }).expect(200))).toEqual([E2, E1]);
    // Step 3.
    expect(ids(await api().listExpenses(std.SA1.actor, { ...range, vehicleId: std.DR1.vehicleId as string }).expect(200))).toEqual([E2, E1]);
    expect(ids(await api().listExpenses(std.SA1.actor, { ...range, driverId: std.DR2.id }).expect(200))).toEqual([E3]);
    expect(
      ids(await api().listExpenses(std.SA1.actor, { ...range, driverId: std.DR2.id, includeVoided: true }).expect(200)),
    ).toEqual([E5, E3]);
    // Step 4: both ends of the range count.
    expect(ids(await api().listExpenses(std.SA1.actor, { from: '2026-10-01', to: '2026-10-05' }).expect(200))).toEqual([E3, E2]);

    // Step 5: pages of two, no repeats or gaps.
    const first = await api().listExpenses(std.SA1.actor, { ...range, limit: 2 }).expect(200);
    expect(ids(first)).toEqual([E4, E3]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await api().listExpenses(std.SA1.actor, { ...range, limit: 2, cursor: first.body.nextCursor }).expect(200);
    expect(ids(second)).toEqual([E2, E1]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('EXP-011 equal dates are ordered by when they were recorded, and paging never skips one', async () => {
    const extra: string[] = [];
    for (const amount of ['1000', '2000', '3000']) {
      const res = await api()
        .createExpense(std.SA1.actor, { expenseDate: '2026-10-05', amountPaisa: `${amount}00`, typeId: types.OTHER, description: 'Same day' })
        .expect(201);
      extra.push(res.body.id);
    }
    try {
      const day = { from: '2026-10-05', to: '2026-10-05' };
      const all = ids(await api().listExpenses(std.SA1.actor, day).expect(200));
      expect(all).toEqual([...extra].reverse().concat(fx.E3));
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: Record<string, string | number> = { ...day, limit: 1 };
        if (cursor) query.cursor = cursor;
        const page = await api().listExpenses(std.SA1.actor, query).expect(200);
        seen.push(...ids(page));
        cursor = page.body.nextCursor;
      } while (cursor);
      expect(seen).toEqual(all);
    } finally {
      await db().expense.deleteMany({ where: { id: { in: extra } } });
      await db().auditLog.deleteMany({ where: { resourceId: { in: extra } } });
    }
  });

  it('EXP-011 list queries are checked: limit 1–100, a cursor this list made, dates in order', async () => {
    for (const limit of ['0', '101', 'abc']) {
      const res = await api().listExpenses(std.SA1.actor, { limit }).expect(400);
      expect(res.body.details.fields[0].path).toBe('limit');
    }
    const cursor = await api().listExpenses(std.SA1.actor, { cursor: Buffer.from('["x"]').toString('base64url') }).expect(400);
    expect(cursor.body.details.fields[0].path).toBe('cursor');
    const reversed = await api().listExpenses(std.SA1.actor, { from: '2026-10-31', to: '2026-10-01' }).expect(400);
    expect(reversed.body.details.fields[0].path).toBe('to');
  });

  it("EXP-012 expense totals by type and by month match the list, and drivers' fuel logs are counted separately by Karachi month", async () => {
    const lea101 = std.DR1.vehicleId as string;
    const leb202 = std.DR2.vehicleId as string;
    const logs = [
      await fuelLog('2026-10-02T06:00:00Z', 150000n, lea101, std.DR1.id, 1200),
      // 04:30 on 1 Oct in Karachi, 30 Sep in UTC.
      await fuelLog('2026-09-30T23:30:00Z', 100000n, leb202, std.DR2.id, 800),
      // 01:30 on 1 Oct in Karachi: before 03:00, so a business date would say 30 Sep. Calendar months don't.
      await fuelLog('2026-09-30T20:30:00Z', 50000n, lea101, std.DR1.id, 1000),
    ];
    try {
      const res = await api().summary(std.SA1.actor, { from: '2026-09-01', to: '2026-10-31' }).expect(200);
      const s = res.body;
      expect(s).toMatchObject({ from: '2026-09-01', to: '2026-10-31', totalPaisa: '600000', count: 4 });
      expect(s.byType).toEqual([
        { typeId: types.PETROL, code: 'PETROL', name: 'Petrol', totalPaisa: '450000', count: 2 },
        { typeId: types.MAINTENANCE, code: 'MAINTENANCE', name: 'Maintenance', totalPaisa: '120000', count: 1 },
        { typeId: types.TOLL_PARKING, code: 'TOLL_PARKING', name: 'Toll/Parking', totalPaisa: '30000', count: 1 },
      ]);
      expect(s.byMonth).toEqual([
        { month: '2026-09', totalPaisa: '200000', byType: [{ typeId: types.PETROL, totalPaisa: '200000' }] },
        {
          month: '2026-10',
          totalPaisa: '400000',
          byType: [
            { typeId: types.PETROL, totalPaisa: '250000' },
            { typeId: types.MAINTENANCE, totalPaisa: '120000' },
            { typeId: types.TOLL_PARKING, totalPaisa: '30000' },
          ],
        },
      ]);
      expect(s.fuelLogs).toEqual({ totalPaisa: '300000', count: 3, byMonth: [{ month: '2026-10', totalPaisa: '300000', count: 3 }] });

      // September alone has no fuel logs: all three fall on 1 Oct or later in Karachi.
      const september = await api().summary(std.SA1.actor, { from: '2026-09-01', to: '2026-09-30' }).expect(200);
      expect(september.body.fuelLogs).toEqual({ totalPaisa: '0', count: 0, byMonth: [] });

      // For every month, the totals equal the sum of the live rows the list shows.
      for (const [from, to] of [
        ['2026-09-01', '2026-09-30'],
        ['2026-10-01', '2026-10-31'],
        ['2026-09-01', '2026-10-31'],
      ]) {
        const list = await api().listExpenses(std.SA1.actor, { from, to, limit: 100 }).expect(200);
        const sum = list.body.items.reduce((acc: bigint, e: { amountPaisa: string }) => acc + BigInt(e.amountPaisa), 0n);
        const totals = await api().summary(std.SA1.actor, { from, to }).expect(200);
        expect({ from, total: totals.body.totalPaisa, count: totals.body.count }).toEqual({
          from,
          total: sum.toString(),
          count: list.body.items.length,
        });
      }

      // The current month by default.
      const current = await api().summary(std.SA1.actor).expect(200);
      expect(current.body).toMatchObject({ from: '2026-10-01', to: '2026-10-31', totalPaisa: '400000', count: 3 });
      clock.set('2026-11-01T19:30:00Z'); // 00:30 on 2 Nov in Karachi
      const november = await api().summary(std.SA1.actor).expect(200);
      expect(november.body).toMatchObject({ from: '2026-11-01', to: '2026-11-30', totalPaisa: '0', count: 0 });
    } finally {
      clock.set('2026-10-22T07:00:00.000Z');
      await db().fuelRefill.deleteMany({ where: { id: { in: logs.map((log) => log.id) } } });
    }
  });

  // 'EXP-012 a row the old API wrote with only a category …' was retired at Increment 2: from inc1b every
  // expense has its type (`expenses.type_id` NOT NULL, DATA_MODEL §3.5), and the inc1b re-derive step that
  // gives such rows their type is proven in test/inc2/db/inc1b-rederive.e2e-spec.ts.
});
