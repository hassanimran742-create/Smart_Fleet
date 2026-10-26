/**
 * EXP-014: expense writes never change a distributor's balance or the ledger (ADR-05, ADR-14;
 * API_CONTRACT §5.1 "expenses: never wallet", §7.12 rule, §8.6). The static half of the case (nothing
 * in the expenses module imports the wallet) is in expenses-module.spec.ts, so it also runs without a
 * database; it is repeated here so this suite proves the whole case on its own.
 */
import type { INestApplication } from '@nestjs/common';
import { getTestPrisma, walletMismatches } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import type { StandardData } from '../helpers/standard-data';
import { walletImportsUnderExpenses } from './expense-module-scan';
import { BOOT_TIMEOUT_MS, createExpensesApp, expensesApi, freshStandardData, OCT_22, typeIds } from './expense-kit';

describeDb('expenses: never the wallet', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    ({ app } = await createExpensesApp());
    std = await freshStandardData(app);
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  const db = () => getTestPrisma();

  async function money() {
    const distributors = await db().distributor.findMany({ select: { id: true, advanceBalancePaisa: true }, orderBy: { id: 'asc' } });
    return { distributors, ledgerRows: await db().ledgerEntry.count() };
  }

  it("EXP-014 expense writes never change a distributor's balance or the ledger", async () => {
    const api = expensesApi(app);
    const types = await typeIds();

    // Step 1.
    const before = await money();
    expect(before.distributors.find((d) => d.id === std.DA.id)?.advanceBalancePaisa).toBe(500000n);
    expect(before.distributors.find((d) => d.id === std.DB.id)?.advanceBalancePaisa).toBe(0n);
    const walletAuditBefore = await db().auditLog.count({ where: { action: { startsWith: 'wallet.' } } });

    // Step 2.
    const e = await api
      .createExpense(std.SA1.actor, { expenseDate: OCT_22, amountPaisa: '250000', typeId: types.PETROL, description: 'Fuel' })
      .expect(201);
    await api.updateExpense(std.SA1.actor, e.body.id, { amountPaisa: '300000' }).expect(200);
    await api.voidExpense(std.SA1.actor, e.body.id, 'Entered twice').expect(200);
    const type = await api.createType(std.SA1.actor, 'Generator fuel').expect(201);
    await api.renameType(std.SA1.actor, type.body.id, 'Generator diesel').expect(200);
    await api.archiveType(std.SA1.actor, type.body.id).expect(200);

    // Step 3.
    expect(await money()).toEqual(before);
    expect(await db().auditLog.count({ where: { action: { startsWith: 'wallet.' } } })).toBe(walletAuditBefore);
    expect(await walletMismatches()).toEqual([]);
    // Every write above left its own audit row, and only those.
    const actions = (await db().auditLog.findMany({ where: { actorUserId: std.SA1.id }, orderBy: { createdAt: 'asc' } })).map((row) => row.action);
    expect(actions).toEqual([
      'expense.create',
      'expense.update',
      'expense.void',
      'expense_type.create',
      'expense_type.rename',
      'expense_type.archive',
    ]);

    // Step 4.
    expect(walletImportsUnderExpenses()).toEqual([]);
  });
});
