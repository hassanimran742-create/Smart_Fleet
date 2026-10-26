/**
 * Unit checks of the expenses module that need no database: EXP-014's static rule (the module never
 * reaches the wallet), the calendar-date rules behind EXP-006 and EXP-012 (Asia/Karachi calendar dates,
 * no 03:00 cut-off), and the old-category mapping of DATA_MODEL §3.4 backfill 11.
 */
import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ExpenseCategory } from '@prisma/client';
import { ExpensesModule } from '../../src/modules/expenses/expenses.module';
import {
  calendarRangeInstants,
  calendarToday,
  monthEnd,
  monthStart,
  resolveRange,
} from '../../src/modules/expenses/expense-dates';
import { categoriesForTypeCode, expenseActions, typeCodeForCategory } from '../../src/modules/expenses/expense-rows';
import { walletImportsUnderExpenses } from './expense-module-scan';

describe('expenses module', () => {
  it('EXP-014 nothing under apps/api/src/modules/expenses imports the wallet module, directly or through another file', () => {
    expect(walletImportsUnderExpenses()).toEqual([]);
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, ExpensesModule) ?? []) as unknown[];
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ExpensesModule) ?? []) as Array<{ name?: string }>;
    expect(imports.map((m) => (m as { name?: string }).name)).not.toContain('WalletModule');
    expect(providers.map((p) => p.name)).not.toContain('WalletService');
  });

  it("EXP-006 today is the Asia/Karachi calendar date, with no 03:00 cut-off", () => {
    // 04:30 in Karachi is 23:30 UTC the day before.
    expect(calendarToday(new Date('2026-10-21T23:30:00Z'), 'Asia/Karachi')).toBe('2026-10-22');
    // 01:00 in Karachi on 22 Oct: the business day would still be the 21st; the calendar date isn't.
    expect(calendarToday(new Date('2026-10-21T20:00:00Z'), 'Asia/Karachi')).toBe('2026-10-22');
    expect(calendarToday(new Date('2026-10-21T18:59:59Z'), 'Asia/Karachi')).toBe('2026-10-21');
  });

  it('EXP-011 the default range is the current calendar month; one bound takes the other from its month', () => {
    expect(resolveRange({}, '2026-10-22')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolveRange({ from: '2026-09-01', to: '2026-10-31' }, '2026-10-22')).toEqual({ from: '2026-09-01', to: '2026-10-31' });
    expect(resolveRange({ to: '2026-09-15' }, '2026-10-22')).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(resolveRange({ from: '2026-08-10' }, '2026-10-22')).toEqual({ from: '2026-08-10', to: '2026-10-31' });
    expect(resolveRange({ from: '2026-12-05' }, '2026-10-22')).toEqual({ from: '2026-12-05', to: '2026-12-31' });
    expect([monthStart('2026-02-17'), monthEnd('2026-02-17'), monthEnd('2028-02-03'), monthEnd('2026-12-31')]).toEqual([
      '2026-02-01',
      '2026-02-28',
      '2028-02-29',
      '2026-12-31',
    ]);
  });

  it('EXP-012 fuel-log months are bounded by Asia/Karachi midnights', () => {
    const { start, end } = calendarRangeInstants('2026-10-01', '2026-10-31', 'Asia/Karachi');
    expect(start.toISOString()).toBe('2026-09-30T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-31T19:00:00.000Z');
  });

  it('an old category reads as the type backfill 11 gave it (DATA_MODEL §3.4)', () => {
    expect(typeCodeForCategory(ExpenseCategory.FUEL)).toBe('PETROL');
    expect(typeCodeForCategory(ExpenseCategory.MAINTENANCE)).toBe('MAINTENANCE');
    expect(typeCodeForCategory(ExpenseCategory.OTHER)).toBe('OTHER');
    expect(typeCodeForCategory(ExpenseCategory.FOOD)).toBe('LEGACY_FOOD');
    expect(categoriesForTypeCode('PETROL')).toEqual([ExpenseCategory.FUEL]);
    expect(categoriesForTypeCode('LEGACY_RENT')).toEqual([ExpenseCategory.RENT]);
    expect(categoriesForTypeCode('REPAIRS')).toEqual([]);
    expect(categoriesForTypeCode(null)).toEqual([]);
  });

  it('EXP-009 a removed expense offers no actions', () => {
    expect(expenseActions({ voidedAt: null })).toEqual(['EDIT', 'VOID']);
    expect(expenseActions({ voidedAt: new Date() })).toEqual([]);
  });
});
