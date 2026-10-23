/**
 * EXP-001, EXP-002, EXP-003: expense types (ADR-14; API_CONTRACT §7.12 "Types", Appendix B;
 * DATA_MODEL §3.3, §3.4). The office adds, renames, archives and restores them; the seeded types keep
 * their codes; Petrol and Other can't be archived; a name is unique ignoring case and spacing, archived
 * types included.
 */
import type { INestApplication } from '@nestjs/common';
import { getTestPrisma } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import type { StandardData } from '../helpers/standard-data';
import { auditRows, BOOT_TIMEOUT_MS, createExpensesApp, expensesApi, freshStandardData, typeIds } from './expense-kit';

describeDb('expenses: expense types', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    ({ app } = await createExpensesApp());
  }, BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    std = await freshStandardData(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const api = () => expensesApi(app);

  it('EXP-001 the six seeded expense types are there, in order, with fixed codes', async () => {
    const res = await api().listTypes(std.SA1.actor).expect(200);
    expect(res.body.map((t: Record<string, unknown>) => [t.name, t.code, t.isSystem, t.archived, t.expenseCount])).toEqual([
      ['Petrol', 'PETROL', true, false, 0],
      ['Maintenance', 'MAINTENANCE', false, false, 0],
      ['Repairs', 'REPAIRS', false, false, 0],
      ['Tyres', 'TYRES', false, false, 0],
      ['Toll/Parking', 'TOLL_PARKING', false, false, 0],
      ['Other', 'OTHER', true, false, 0],
    ]);
    for (const type of res.body) {
      expect(Object.keys(type).sort()).toEqual(['archived', 'code', 'expenseCount', 'id', 'isSystem', 'name', 'sortOrder']);
    }
    // Step 2: a fresh database has no LEGACY_ types (there were no old expenses).
    const all = await api().listTypes(std.SA1.actor, true).expect(200);
    expect(all.body).toEqual(res.body);
  });

  it('EXP-002 add a custom expense type; names must be 2-40 characters and unique, ignoring case and extra spaces', async () => {
    // Step 1.
    const created = await api().createType(std.SA1.actor, 'Driver meals').expect(201);
    expect(created.body).toMatchObject({ name: 'Driver meals', code: null, isSystem: false, archived: false, expenseCount: 0 });
    const mealsId: string = created.body.id;

    // Steps 2–3: the existing type's stored name is named (G13-02).
    const spaced = await api().createType(std.SA1.actor, '  driver   MEALS ').expect(409);
    expect(spaced.body).toMatchObject({
      code: 'EXPENSE_TYPE_NAME_TAKEN',
      message: "There's already a type called Driver meals.",
      details: { name: 'Driver meals' },
    });
    const petrol = await api().createType(std.SA1.actor, 'petrol').expect(409);
    expect(petrol.body).toMatchObject({ code: 'EXPENSE_TYPE_NAME_TAKEN', message: "There's already a type called Petrol." });
    const petrolSpace = await api().createType(std.SA1.actor, 'petrol ').expect(409);
    expect(petrolSpace.body).toMatchObject({ code: 'EXPENSE_TYPE_NAME_TAKEN', details: { name: 'Petrol' } });

    // Step 4: 2–40 characters.
    for (const name of ['X', 'Y'.repeat(41)]) {
      const res = await api().createType(std.SA1.actor, name).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.fields.map((f: { path: string }) => f.path)).toEqual(['name']);
    }
    const forty = await api().createType(std.SA1.actor, 'Z'.repeat(40)).expect(201);
    expect(forty.body.name).toBe('Z'.repeat(40));

    // Step 5: an archived type keeps its name.
    const archived = await api().archiveType(std.SA1.actor, mealsId).expect(200);
    expect(archived.body.archived).toBe(true);
    const again = await api().createType(std.SA1.actor, 'driver meals').expect(409);
    expect(again.body).toMatchObject({ code: 'EXPENSE_TYPE_NAME_TAKEN', message: "There's already a type called Driver meals." });

    // Step 6.
    const restored = await api().restoreType(std.SA1.actor, mealsId).expect(200);
    expect(restored.body).toMatchObject({ id: mealsId, archived: false });

    // Step 7: one create row per type created, by SA1, and nothing for the refused ones.
    const rows = await auditRows(app, std.SA1.actor, { action: 'expense_type.create' });
    expect(rows.map((row) => [row.resourceId, row.actor.userId, row.diff?.after?.name])).toEqual([
      [mealsId, std.SA1.id, 'Driver meals'],
      [forty.body.id, std.SA1.id, 'Z'.repeat(40)],
    ]);
    expect(await getTestPrisma().expenseType.count()).toBe(8);
  });

  it('EXP-001 an archived legacy type is listed only with includeArchived, and its name stays taken', async () => {
    // As inc1a's backfill 11 makes them on a copy of live data (DATA_MODEL §3.4).
    await getTestPrisma().$executeRaw`
      INSERT INTO expense_types (id, code, name, name_key, is_system, sort_order, archived_at, created_at, updated_at)
      VALUES (gen_random_uuid(), 'LEGACY_FOOD', 'Food', 'food', false, 900, now(), now(), now())`;
    const active = await api().listTypes(std.SA1.actor).expect(200);
    expect(active.body.map((t: { code: string }) => t.code)).not.toContain('LEGACY_FOOD');
    const all = await api().listTypes(std.SA1.actor, true).expect(200);
    expect(all.body.map((t: { code: string }) => t.code)).toEqual(['PETROL', 'MAINTENANCE', 'REPAIRS', 'TYRES', 'TOLL_PARKING', 'LEGACY_FOOD', 'OTHER']);
    expect(all.body.find((t: { code: string }) => t.code === 'LEGACY_FOOD')).toMatchObject({ name: 'Food', archived: true, isSystem: false, sortOrder: 900 });
    const taken = await api().createType(std.SA1.actor, 'food').expect(409);
    expect(taken.body).toMatchObject({ code: 'EXPENSE_TYPE_NAME_TAKEN', message: "There's already a type called Food." });
  });

  it("EXP-003 rename, archive and restore expense types; Petrol and Other can't be archived", async () => {
    const meals = await api().createType(std.SA1.actor, 'Driver meals').expect(201);
    const ids = await typeIds();

    // Step 1: the code never changes.
    const tyres = await api().renameType(std.SA1.actor, ids.TYRES, 'Tyres & tubes').expect(200);
    expect(tyres.body).toMatchObject({ id: ids.TYRES, name: 'Tyres & tubes', code: 'TYRES' });

    // Step 2.
    const fuel = await api().renameType(std.SA1.actor, ids.PETROL, 'Fuel (petrol)').expect(200);
    expect(fuel.body).toMatchObject({ name: 'Fuel (petrol)', code: 'PETROL', isSystem: true });
    const back = await api().renameType(std.SA1.actor, ids.PETROL, 'Petrol').expect(200);
    expect(back.body).toMatchObject({ name: 'Petrol', code: 'PETROL' });

    // Step 3.
    const taken = await api().renameType(std.SA1.actor, ids.REPAIRS, 'maintenance').expect(409);
    expect(taken.body).toMatchObject({ code: 'EXPENSE_TYPE_NAME_TAKEN', details: { name: 'Maintenance' } });
    expect((await getTestPrisma().expenseType.findUniqueOrThrow({ where: { id: ids.REPAIRS } })).name).toBe('Repairs');

    // Step 4, with each repeat answered as already applied.
    expect((await api().archiveType(std.SA1.actor, meals.body.id).expect(200)).body.archived).toBe(true);
    const archiveAgain = await api().archiveType(std.SA1.actor, meals.body.id).expect(200);
    expect(archiveAgain.headers['x-already-applied']).toBe('true');
    expect((await api().restoreType(std.SA1.actor, meals.body.id).expect(200)).body.archived).toBe(false);
    const restoreAgain = await api().restoreType(std.SA1.actor, meals.body.id).expect(200);
    expect(restoreAgain.headers['x-already-applied']).toBe('true');

    // Step 5.
    const lockedPetrol = await api().archiveType(std.SA1.actor, ids.PETROL).expect(409);
    expect(lockedPetrol.body).toMatchObject({ code: 'EXPENSE_TYPE_LOCKED', message: "Petrol can't be archived." });
    const lockedOther = await api().archiveType(std.SA1.actor, ids.OTHER).expect(409);
    expect(lockedOther.body).toMatchObject({ code: 'EXPENSE_TYPE_LOCKED', message: "Other can't be archived." });
    const system = await getTestPrisma().expenseType.findMany({ where: { code: { in: ['PETROL', 'OTHER'] } } });
    expect(system.every((type) => type.archivedAt === null)).toBe(true);

    // Step 6: old and new names on the rename rows; one archive and one restore row; all by SA1.
    const renames = await auditRows(app, std.SA1.actor, { action: 'expense_type.rename' });
    expect(renames.map((row) => [row.resourceId, row.diff.before.name, row.diff.after.name, row.actor.userId])).toEqual([
      [ids.TYRES, 'Tyres', 'Tyres & tubes', std.SA1.id],
      [ids.PETROL, 'Petrol', 'Fuel (petrol)', std.SA1.id],
      [ids.PETROL, 'Fuel (petrol)', 'Petrol', std.SA1.id],
    ]);
    for (const action of ['expense_type.archive', 'expense_type.restore']) {
      const rows = await auditRows(app, std.SA1.actor, { action });
      expect(rows.map((row) => [row.resourceId, row.actor.userId])).toEqual([[meals.body.id, std.SA1.id]]);
    }

    // Teardown of the case: back to "Tyres". A new spelling of its own name is allowed too.
    await api().renameType(std.SA1.actor, ids.TYRES, 'Tyres').expect(200);
    expect((await api().renameType(std.SA1.actor, ids.TYRES, 'tyres').expect(200)).body.name).toBe('tyres');
  });

  it('EXP-003 an unknown or malformed type id is 404 NOT_FOUND on every type route', async () => {
    for (const id of ['7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7', 'not-a-uuid']) {
      expect((await api().renameType(std.SA1.actor, id, 'Anything').expect(404)).body.code).toBe('NOT_FOUND');
      expect((await api().archiveType(std.SA1.actor, id).expect(404)).body.code).toBe('NOT_FOUND');
      expect((await api().restoreType(std.SA1.actor, id).expect(404)).body.code).toBe('NOT_FOUND');
    }
  });

  it('EXP-002 two adds of one name at the same moment make one type and one 409', async () => {
    const results = await Promise.all([
      api().createType(std.SA1.actor, 'Staff meals'),
      api().createType(std.SA2.actor, 'staff  meals'),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    const refused = results.find((res) => res.status === 409)!;
    expect(refused.body.code).toBe('EXPENSE_TYPE_NAME_TAKEN');
    expect(await getTestPrisma().expenseType.count({ where: { nameKey: 'staff meals' } })).toBe(1);
    expect(await getTestPrisma().auditLog.count({ where: { action: 'expense_type.create' } })).toBe(1);
  });
});
