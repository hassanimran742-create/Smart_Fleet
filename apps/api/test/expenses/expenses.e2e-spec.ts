/**
 * EXP-004, EXP-005, EXP-006, EXP-008, EXP-009, EXP-010, EXP-013: recording, editing and removing
 * expenses (ADR-14; API_CONTRACT §7.12, §4, §1.1, Appendix B; DATA_MODEL §3.2, §3.4). The expenses
 * clock is fixed (expense-kit.ts), so "today" is a known Asia/Karachi calendar date.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { authHeader } from '../helpers/auth';
import { getTestPrisma } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import type { StandardData } from '../helpers/standard-data';
import {
  auditRows,
  BOOT_TIMEOUT_MS,
  createExpensesApp,
  expensesApi,
  freshStandardData,
  jpegOf,
  OCT_22,
  PKT_OCT_22_NOON,
  typeIds,
  upload,
  type FixedClock,
} from './expense-kit';

describeDb('expenses: record, edit and remove', () => {
  let app: INestApplication;
  let clock: FixedClock;
  let std: StandardData;
  let types: Record<string, string>;

  beforeAll(async () => {
    ({ app, clock } = await createExpensesApp());
  }, BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    clock.set(PKT_OCT_22_NOON);
    std = await freshStandardData(app);
    types = await typeIds();
  });

  afterAll(async () => {
    await app?.close();
  });

  const api = () => expensesApi(app);
  const db = () => getTestPrisma();
  const lea101 = () => std.DR1.vehicleId as string;
  const leb202 = () => std.DR2.vehicleId as string;

  /** A valid body (today, Rs 2,500, Petrol) with `overrides`. */
  const body = (overrides: Record<string, unknown> = {}) => ({
    expenseDate: OCT_22,
    amountPaisa: '250000',
    typeId: types.PETROL,
    description: 'Fuel for LEA-101',
    ...overrides,
  });

  it("EXP-004 an archived type can't be picked for a new or changed expense, but its old expenses keep it", async () => {
    const meals = await api().createType(std.SA1.actor, 'Driver meals').expect(201);
    const e1 = await api().createExpense(std.SA1.actor, body({ amountPaisa: '60000', typeId: meals.body.id, description: 'Lunch' })).expect(201);
    const e2 = await api().createExpense(std.SA1.actor, body()).expect(201);
    await api().archiveType(std.SA1.actor, meals.body.id).expect(200);

    // Step 1.
    const refused = await api()
      .createExpense(std.SA1.actor, body({ amountPaisa: '50000', typeId: meals.body.id, description: 'Lunch' }))
      .expect(409);
    expect(refused.body).toMatchObject({
      code: 'EXPENSE_TYPE_ARCHIVED',
      message: 'Driver meals is archived. Pick another type or restore it.',
      details: { name: 'Driver meals' },
    });
    // Step 2: E2 stays Petrol.
    const moved = await api().updateExpense(std.SA1.actor, e2.body.id, { typeId: meals.body.id }).expect(409);
    expect(moved.body.code).toBe('EXPENSE_TYPE_ARCHIVED');
    expect((await db().expense.findUniqueOrThrow({ where: { id: e2.body.id } })).typeId).toBe(types.PETROL);
    // Step 3: keeping its archived type is fine, also when the type is sent again unchanged.
    const kept = await api().updateExpense(std.SA1.actor, e1.body.id, { amountPaisa: '70000' }).expect(200);
    expect(kept.body).toMatchObject({ amountPaisa: '70000', type: { id: meals.body.id, name: 'Driver meals' } });
    await api().updateExpense(std.SA1.actor, e1.body.id, { typeId: meals.body.id, description: 'Lunch for two' }).expect(200);

    // Step 4.
    const list = await api().listExpenses(std.SA1.actor).expect(200);
    expect(list.body.items.find((e: { id: string }) => e.id === e1.body.id)).toMatchObject({ type: { name: 'Driver meals' }, amountPaisa: '70000' });
    const summary = await api().summary(std.SA1.actor).expect(200);
    expect(summary.body.byType).toEqual(
      expect.arrayContaining([expect.objectContaining({ typeId: meals.body.id, name: 'Driver meals', totalPaisa: '70000', count: 1 })]),
    );
    // Step 5.
    const active = await api().listTypes(std.SA1.actor).expect(200);
    expect(active.body.map((t: { name: string }) => t.name)).not.toContain('Driver meals');
  });

  it('EXP-005 record an expense with every field, and one with only the required fields', async () => {
    const receipt = await upload(app, std.SA1.actor, jpegOf(40_000), {
      filename: 'receipt.jpg',
      contentType: 'image/jpeg',
      purpose: 'EXPENSE_RECEIPT',
    }).expect(201);
    const r1: string = receipt.body.fileId;

    // Step 1.
    const full = await api()
      .createExpense(
        std.SA1.actor,
        body({ vehicleId: lea101(), driverId: std.DR1.id, receiptFileId: r1 }),
      )
      .expect(201);
    expect(full.body).toMatchObject({
      expenseDate: OCT_22,
      amountPaisa: '250000',
      type: { id: types.PETROL, code: 'PETROL', name: 'Petrol' },
      vehicle: { id: lea101(), plateNo: 'LEA-101' },
      driver: { id: std.DR1.id, name: 'Kashif' },
      description: 'Fuel for LEA-101',
      receiptFileId: r1,
      recordedBy: { id: std.SA1.id, name: 'Owner' },
      voidedAt: null,
      voidReason: null,
      voidedBy: null,
      allowedActions: ['EDIT', 'VOID'],
    });
    expect(full.body.receiptUrl).toContain('X-Amz-Expires=3600');
    expect(full.body.receiptUrl).toContain(receipt.body.key);

    // Step 2.
    const minimal = await api()
      .createExpense(std.SA1.actor, { expenseDate: OCT_22, amountPaisa: '30000', typeId: types.TOLL_PARKING, description: 'Parking at Liberty' })
      .expect(201);
    expect(minimal.body).toMatchObject({
      amountPaisa: '30000',
      type: { code: 'TOLL_PARKING', name: 'Toll/Parking' },
      vehicle: null,
      driver: null,
      receiptFileId: null,
      receiptUrl: null,
      description: 'Parking at Liberty',
    });

    // Step 3.
    const rows = await auditRows(app, std.SA1.actor, { action: 'expense.create' });
    expect(rows.map((row) => [row.resourceId, row.actor.userId, row.resourceType])).toEqual([
      [full.body.id, std.SA1.id, 'Expense'],
      [minimal.body.id, std.SA1.id, 'Expense'],
    ]);
    expect(rows[0].diff.after).toMatchObject({ amountPaisa: '250000', expenseDate: OCT_22, typeName: 'Petrol', receiptFileId: r1 });
    // The legacy columns are never written.
    const stored = await db().expense.findUniqueOrThrow({ where: { id: full.body.id } });
    expect(stored).toMatchObject({ category: null, vendor: null, notes: null, receiptUrl: null });
  });

  it('EXP-006 expense field rules: amount, date (judged in Asia/Karachi), note, and a van and driver that exist', async () => {
    // Step 1.
    const zero = await api().createExpense(std.SA1.actor, body({ amountPaisa: '0' })).expect(400);
    expect(zero.body.code).toBe('VALIDATION_FAILED');
    expect(zero.body.details.fields[0]).toMatchObject({ path: 'amountPaisa' });
    const paisa = await api().createExpense(std.SA1.actor, body({ amountPaisa: '250050' })).expect(400);
    expect(paisa.body).toMatchObject({ code: 'AMOUNT_NOT_WHOLE_RUPEES', message: 'Enter whole rupees, with no paisa.' });
    const million = await api().createExpense(std.SA1.actor, body({ amountPaisa: '100000000' })).expect(201);
    expect(million.body.amountPaisa).toBe('100000000');
    const over = await api().createExpense(std.SA1.actor, body({ amountPaisa: '100000100' })).expect(400);
    expect(over.body.code).toBe('VALIDATION_FAILED');
    expect(over.body.details.fields[0]).toMatchObject({ path: 'amountPaisa', code: 'AMOUNT_TOO_LARGE' });

    // Step 2: tomorrow in Asia/Karachi.
    const tomorrow = await api().createExpense(std.SA1.actor, body({ expenseDate: '2026-10-23' })).expect(400);
    expect(tomorrow.body).toMatchObject({ code: 'EXPENSE_DATE_IN_FUTURE', message: "The date can't be in the future." });

    // Step 3: 04:30 in Karachi is 23:30 UTC the day before; "today" is the Karachi date.
    clock.set('2026-10-21T23:30:00.000Z');
    await api().createExpense(std.SA1.actor, body({ expenseDate: OCT_22 })).expect(201);
    clock.set(PKT_OCT_22_NOON);

    // Step 4.
    for (const description of ['', 'n'.repeat(201)]) {
      const res = await api().createExpense(std.SA1.actor, body({ description })).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.fields.map((f: { path: string }) => f.path)).toEqual(['description']);
    }
    await api().createExpense(std.SA1.actor, body({ description: 'n'.repeat(200) })).expect(201);

    // Step 5.
    const van = await api().createExpense(std.SA1.actor, body({ vehicleId: randomUUID() })).expect(404);
    expect(van.body).toMatchObject({ code: 'NOT_FOUND', details: { field: 'vehicleId' } });
    const driver = await api().createExpense(std.SA1.actor, body({ driverId: randomUUID() })).expect(404);
    expect(driver.body).toMatchObject({ code: 'NOT_FOUND', details: { field: 'driverId' } });
    const type = await api().createExpense(std.SA1.actor, body({ typeId: randomUUID() })).expect(404);
    expect(type.body).toMatchObject({ code: 'NOT_FOUND', details: { field: 'typeId' } });

    // Step 6: 01:00 in Karachi on 22 Oct (20:00 UTC on 21 Oct). A calendar date, no 03:00 cut-off.
    clock.set('2026-10-21T20:00:00.000Z');
    await api().createExpense(std.SA1.actor, body({ expenseDate: '2026-10-22' })).expect(201);
    const next = await api().createExpense(std.SA1.actor, body({ expenseDate: '2026-10-23' })).expect(400);
    expect(next.body.code).toBe('EXPENSE_DATE_IN_FUTURE');

    // Nothing refused was written.
    expect(await db().expense.count()).toBe(4);
  });

  it('EXP-006 an edit follows the same date rule', async () => {
    const e = await api().createExpense(std.SA1.actor, body({ expenseDate: '2026-10-20' })).expect(201);
    const future = await api().updateExpense(std.SA1.actor, e.body.id, { expenseDate: '2026-10-23' }).expect(400);
    expect(future.body.code).toBe('EXPENSE_DATE_IN_FUTURE');
    clock.set('2026-10-21T20:00:00.000Z');
    const moved = await api().updateExpense(std.SA1.actor, e.body.id, { expenseDate: '2026-10-22' }).expect(200);
    expect(moved.body.expenseDate).toBe('2026-10-22');
  });

  it('EXP-008 editing an expense is audited with before and after values; a removed expense can\'t be edited', async () => {
    const receipt = await upload(app, std.SA1.actor, jpegOf(20_000, 0x42), {
      filename: 'receipt.jpg',
      contentType: 'image/jpeg',
      purpose: 'EXPENSE_RECEIPT',
    }).expect(201);
    const e = await api()
      .createExpense(std.SA1.actor, body({ vehicleId: lea101(), driverId: std.DR1.id, receiptFileId: receipt.body.fileId }))
      .expect(201);

    // Step 1.
    const edited = await api()
      .updateExpense(std.SA1.actor, e.body.id, { amountPaisa: '300000', description: 'Fuel for LEA-101 (corrected)' })
      .expect(200);
    expect(edited.body).toMatchObject({
      amountPaisa: '300000',
      description: 'Fuel for LEA-101 (corrected)',
      expenseDate: OCT_22,
      type: { id: types.PETROL },
      vehicle: { id: lea101() },
      driver: { id: std.DR1.id },
      receiptFileId: receipt.body.fileId,
    });

    // Step 2.
    const rows = await auditRows(app, std.SA1.actor, { action: 'expense.update', resourceId: e.body.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].actor.userId).toBe(std.SA1.id);
    expect(rows[0].diff.before).toEqual({ amountPaisa: '250000', description: 'Fuel for LEA-101' });
    expect(rows[0].diff.after).toEqual({ amountPaisa: '300000', description: 'Fuel for LEA-101 (corrected)' });

    // Step 3: fields that aren't editable are never copied onto the expense.
    await api()
      .updateExpense(std.SA1.actor, e.body.id, { recordedByUserId: std.SA2.id, voidedAt: '2026-01-01T00:00:00Z' })
      .expect(200);
    const stored = await db().expense.findUniqueOrThrow({ where: { id: e.body.id } });
    expect(stored).toMatchObject({ recordedByUserId: std.SA1.id, voidedAt: null, amountPaisa: 300000n });
    expect(await db().auditLog.count({ where: { action: 'expense.update' } })).toBe(1);

    // Null clears the van, the driver and the receipt.
    const cleared = await api()
      .updateExpense(std.SA1.actor, e.body.id, { vehicleId: null, driverId: null, receiptFileId: null })
      .expect(200);
    expect(cleared.body).toMatchObject({ vehicle: null, driver: null, receiptFileId: null, receiptUrl: null });

    // Step 4.
    await api().voidExpense(std.SA1.actor, e.body.id, 'Entered twice').expect(200);
    const refused = await api().updateExpense(std.SA1.actor, e.body.id, { amountPaisa: '100000' }).expect(409);
    expect(refused.body).toMatchObject({ code: 'EXPENSE_ALREADY_VOIDED', message: 'This expense was already removed.' });
    expect((await db().expense.findUniqueOrThrow({ where: { id: e.body.id } })).amountPaisa).toBe(300000n);
  });

  it('EXP-009 removing an expense is a void with a reason, never a hard delete', async () => {
    const e = await api().createExpense(std.SA1.actor, body({ amountPaisa: '180000' })).expect(201);

    // Step 1.
    const short = await api().voidExpense(std.SA1.actor, e.body.id, 'abcd').expect(400);
    expect(short.body.code).toBe('VALIDATION_FAILED');
    expect(short.body.details.fields[0]).toMatchObject({ path: 'reason' });

    // Step 2, and the repeat.
    const voided = await api().voidExpense(std.SA1.actor, e.body.id, 'Entered twice').expect(200);
    expect(voided.body).toMatchObject({
      id: e.body.id,
      voidReason: 'Entered twice',
      voidedBy: { id: std.SA1.id, name: 'Owner' },
      allowedActions: [],
    });
    expect(Date.parse(voided.body.voidedAt)).not.toBeNaN();
    expect(voided.headers['x-already-applied']).toBeUndefined();
    const repeat = await api().voidExpense(std.SA1.actor, e.body.id, 'Entered twice').expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(repeat.body).toMatchObject({ id: e.body.id, voidReason: 'Entered twice' });

    // Step 3: the route is gone and the row stays.
    await http(app).delete(`/api/v1/expenses/${e.body.id}`).set(authHeader(std.SA1.actor)).expect(404);
    expect(await db().expense.count({ where: { id: e.body.id } })).toBe(1);

    // Step 4.
    const list = await api().listExpenses(std.SA1.actor).expect(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).not.toContain(e.body.id);
    const all = await api().listExpenses(std.SA1.actor, { includeVoided: true }).expect(200);
    expect(all.body.items.map((x: { id: string }) => x.id)).toContain(e.body.id);
    const summary = await api().summary(std.SA1.actor).expect(200);
    expect(summary.body).toMatchObject({ totalPaisa: '0', count: 0, byType: [] });

    // Step 5.
    const rows = await auditRows(app, std.SA1.actor, { action: 'expense.void', resourceId: e.body.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'Entered twice', actor: { userId: std.SA1.id } });

    // The database refuses a half-removed row (expenses_void_chk).
    await expect(db().expense.update({ where: { id: e.body.id }, data: { voidReason: null } })).rejects.toThrow();
  });

  it('EXP-009 an unknown or malformed expense id is 404 NOT_FOUND on edit and void', async () => {
    for (const id of [randomUUID(), 'abc']) {
      expect((await api().updateExpense(std.SA1.actor, id, { amountPaisa: '10000' }).expect(404)).body.code).toBe('NOT_FOUND');
      expect((await api().voidExpense(std.SA1.actor, id, 'Entered twice').expect(404)).body.code).toBe('NOT_FOUND');
    }
  });

  it('EXP-010 the same Idempotency-Key makes one expense, whether it is retried or sent twice at the same moment', async () => {
    const k1 = randomUUID();
    const oilChange = body({
      amountPaisa: '120000',
      typeId: types.MAINTENANCE,
      vehicleId: leb202(),
      driverId: std.DR2.id,
      description: 'Oil change',
    });

    // Step 1.
    const first = await api().createExpense(std.SA1.actor, oilChange, k1).expect(201);
    expect(first.headers['idempotent-replay']).toBeUndefined();
    const retry = await api().createExpense(std.SA1.actor, oilChange, k1).expect(200);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
    // The key is compared lower-cased; the note isn't one of the compared fields.
    const upper = await api().createExpense(std.SA1.actor, { ...oilChange, description: 'Oil change (again)' }, k1.toUpperCase()).expect(200);
    expect(upper.body).toMatchObject({ id: first.body.id, description: 'Oil change' });

    // Step 2.
    const changed = await api().createExpense(std.SA1.actor, { ...oilChange, amountPaisa: '130000' }, k1).expect(409);
    expect(changed.body.code).toBe('IDEMPOTENCY_CONFLICT');
    const k2 = randomUUID();
    const parking = body({ amountPaisa: '20000', typeId: types.TOLL_PARKING, description: 'Parking' });

    // Step 3: two identical requests at the same moment.
    const pair = await Promise.all([
      api().createExpense(std.SA1.actor, parking, k2),
      api().createExpense(std.SA1.actor, parking, k2),
    ]);
    expect(pair.map((res) => res.status).sort()).toEqual([200, 201]);
    expect(pair[0].body.id).toBe(pair[1].body.id);
    expect(pair.find((res) => res.status === 200)!.headers['idempotent-replay']).toBe('true');

    // Step 4.
    const list = await api().listExpenses(std.SA1.actor, { includeVoided: true }).expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.filter((e: { amountPaisa: string }) => e.amountPaisa === '120000')).toHaveLength(1);
    const rows = await auditRows(app, std.SA1.actor, { action: 'expense.create' });
    expect(rows.map((row) => row.resourceId).sort()).toEqual([first.body.id, pair[0].body.id].sort());

    // A malformed key is refused before anything is written.
    const bad = await api().createExpense(std.SA1.actor, parking, 'not-a-uuid').expect(400);
    expect(bad.body.details.fields[0]).toMatchObject({ path: 'Idempotency-Key', code: 'INVALID_ID' });
    expect(await db().expense.count()).toBe(2);
  });

  it('EXP-010 a retried create is answered with the first expense even after its rules would now refuse it', async () => {
    const meals = await api().createType(std.SA1.actor, 'Driver meals').expect(201);
    const key = randomUUID();
    const lunch = body({ amountPaisa: '60000', typeId: meals.body.id, description: 'Lunch' });
    const first = await api().createExpense(std.SA1.actor, lunch, key).expect(201);
    await api().archiveType(std.SA1.actor, meals.body.id).expect(200);
    const retry = await api().createExpense(std.SA1.actor, lunch, key).expect(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.headers['idempotent-replay']).toBe('true');
  });

  it('EXP-013 only the office can read or write expenses and expense types', async () => {
    const e = await api().createExpense(std.SA1.actor, body()).expect(201);
    const before = { expenses: await db().expense.count(), types: await db().expenseType.count(), audit: await db().auditLog.count() };

    for (const person of [std.DA, std.DR1]) {
      const calls = [
        api().listExpenses(person.actor),
        api().summary(person.actor),
        api().listTypes(person.actor),
        api().createExpense(person.actor, body()),
        api().updateExpense(person.actor, e.body.id, { amountPaisa: '100000' }),
        api().voidExpense(person.actor, e.body.id, 'Not mine to remove'),
        api().createType(person.actor, 'Hack'),
        api().renameType(person.actor, types.PETROL, 'Hacked'),
        api().archiveType(person.actor, types.TYRES),
        api().restoreType(person.actor, types.TYRES),
      ];
      for (const res of await Promise.all(calls)) {
        expect({ status: res.status, code: res.body.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      }
    }
    const stored = await db().expense.findUniqueOrThrow({ where: { id: e.body.id } });
    expect(stored).toMatchObject({ amountPaisa: 250000n, voidedAt: null });
    expect({ expenses: await db().expense.count(), types: await db().expenseType.count(), audit: await db().auditLog.count() }).toEqual(before);

    // Step 2.
    const anonymous = await http(app).get('/api/v1/expenses').expect(401);
    expect(anonymous.body.code).toBe('AUTH_TOKEN_INVALID');
  });
});
