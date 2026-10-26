/**
 * Unit tests for the money lane's pure rules: wallet-history kinds, subjects and views (API_CONTRACT
 * §1.4, §7.8), statement date bounds, top-up limits, cap, bank time, search and PaymentDto words (§7.9).
 */
import type { Prisma } from '@prisma/client';
import { AppError } from '../../src/common/errors/app-error';
import { paymentActions, paymentStage, creditedPaisa, toPaymentDto, type PaymentRow } from '../../src/modules/payments/payment.dto';
import {
  assertTopupAmount,
  assertUnderCap,
  isBankTimeInFuture,
  parseTopupShortCode,
  roomUnderCap,
  TAB_STATUSES,
  topupSearchWhere,
} from '../../src/modules/payments/topup.rules';
import { statementBound } from '../../src/modules/wallet/business-day';
import { KIND_WHERE, kindsWhere, statementKindOf, statementSubject, toStatementItem, type StatementRow } from '../../src/modules/wallet/statement';

function thrown(fn: () => void): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PAYMENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function row(overrides: Partial<StatementRow>): StatementRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    entryType: 'ADJUSTMENT',
    amountPaisa: 10_000n,
    balanceAfterPaisa: 510_000n,
    reasonCode: 'SYSTEM_ERROR',
    note: 'A note only the office reads',
    orderId: null,
    paymentId: null,
    createdByUserId: USER_ID,
    createdAt: new Date('2026-10-22T05:00:00.000Z'),
    order: null,
    payment: null,
    ...overrides,
  };
}

const ctx = { distributorCode: 'AG', userNames: new Map([[USER_ID, 'Owner']]) };
const withOrder = { orderId: ORDER_ID, order: { id: ORDER_ID, orderNo: 142, client: { name: 'Sana' } } };
const withPayment = { paymentId: PAYMENT_ID, payment: { id: PAYMENT_ID, requestNo: 31, bankReference: 'FT-7781-4402' } };

describe('wallet history kinds (API_CONTRACT §1.4)', () => {
  it('WAL-005 maps every ledger row to its plain kind', () => {
    expect(statementKindOf('CREDIT_TOPUP', null)).toBe('TOPUP_ADDED');
    expect(statementKindOf('DEBIT_ORDER', null)).toBe('DELIVERY_COST');
    expect(statementKindOf('CREDIT_ORDER_REVERSAL', null)).toBe('DELIVERY_COST_RETURNED');
    expect(statementKindOf('DEBIT_REFILL', null)).toBe('REFILL_DELIVERY_COST');
    expect(statementKindOf('ADJUSTMENT', null)).toBe('LEGACY');
    expect(statementKindOf('ADJUSTMENT', 'SYSTEM_ERROR')).toBe('CORRECTION');
    expect(statementKindOf('ADJUSTMENT', 'OTHER')).toBe('CORRECTION');
  });

  it('G01-04 every adjustment with reason OPENING_BALANCE reads "Opening balance", whoever wrote it', () => {
    expect(statementKindOf('ADJUSTMENT', 'OPENING_BALANCE')).toBe('OPENING_BALANCE');
    const migration = toStatementItem(row({ reasonCode: 'OPENING_BALANCE', createdByUserId: null }), ctx, 'OFFICE');
    const office = toStatementItem(row({ reasonCode: 'OPENING_BALANCE' }), ctx, 'OFFICE');
    expect([migration.kind, office.kind]).toEqual(['OPENING_BALANCE', 'OPENING_BALANCE']);
    expect([migration.reasonCode, office.reasonCode]).toEqual(['OPENING_BALANCE', 'OPENING_BALANCE']);
  });

  it('G01-10 the kind filter takes one kind or a list', () => {
    expect(kindsWhere(undefined)).toBeUndefined();
    expect(kindsWhere([])).toBeUndefined();
    expect(kindsWhere(['DELIVERY_COST'])).toEqual(KIND_WHERE.DELIVERY_COST);
    expect(kindsWhere(['DELIVERY_COST', 'DELIVERY_COST_RETURNED'])).toEqual({ OR: [KIND_WHERE.DELIVERY_COST, KIND_WHERE.DELIVERY_COST_RETURNED] });
    expect(KIND_WHERE.CORRECTION).toEqual({
      entryType: 'ADJUSTMENT',
      AND: [{ reasonCode: { not: null } }, { reasonCode: { not: 'OPENING_BALANCE' } }],
    });
    expect(KIND_WHERE.LEGACY).toEqual({ entryType: 'ADJUSTMENT', reasonCode: null });
  });
});

describe('statement items (API_CONTRACT §7.8)', () => {
  it('WAL-019 money is a signed digit string and the time an ISO instant', () => {
    const item = toStatementItem(row({ entryType: 'DEBIT_ORDER', amountPaisa: -25_000n, balanceAfterPaisa: 475_000n, reasonCode: null, ...withOrder }), ctx, 'DISTRIBUTOR');
    expect(item).toMatchObject({ amountPaisa: '-25000', balanceAfterPaisa: '475000', at: '2026-10-22T05:00:00.000Z', reasonCode: null });
  });

  it('WAL-005 the distributor view carries no note, author or bank reference; the office view always does', () => {
    const topup = row({ entryType: 'CREDIT_TOPUP', reasonCode: null, ...withPayment });
    const shop = toStatementItem(topup, ctx, 'DISTRIBUTOR');
    expect(shop).not.toHaveProperty('note');
    expect(shop).not.toHaveProperty('by');
    expect(shop.subject).toEqual({ type: 'TOPUP', id: PAYMENT_ID, shortCode: 'AG-T031', clientName: null });
    const office = toStatementItem(topup, ctx, 'OFFICE');
    expect(office).toMatchObject({ note: 'A note only the office reads', by: { name: 'Owner' } });
    expect(office.subject).toEqual({ type: 'TOPUP', id: PAYMENT_ID, shortCode: 'AG-T031', clientName: null, bankReference: 'FT-7781-4402' });
    const system = toStatementItem(row({ createdByUserId: null, note: null }), ctx, 'OFFICE');
    expect(system).toMatchObject({ note: null, by: null });
  });

  it("G01-09 order rows carry the customer's name", () => {
    const item = toStatementItem(row({ entryType: 'CREDIT_ORDER_REVERSAL', reasonCode: null, ...withOrder }), ctx, 'DISTRIBUTOR');
    expect(item.subject).toEqual({ type: 'ORDER', id: ORDER_ID, shortCode: 'AG-0142', clientName: 'Sana' });
  });

  it("G01-02 a correction's subject is its related order, else its related top-up, else nothing", () => {
    expect(statementSubject(row({ ...withOrder, ...withPayment }), ctx, 'DISTRIBUTOR')).toMatchObject({ type: 'ORDER', id: ORDER_ID });
    expect(statementSubject(row({ ...withPayment }), ctx, 'DISTRIBUTOR')).toMatchObject({ type: 'TOPUP', id: PAYMENT_ID });
    expect(statementSubject(row({}), ctx, 'DISTRIBUTOR')).toBeNull();
    expect(statementSubject(row({ entryType: 'DEBIT_REFILL', reasonCode: null }), ctx, 'OFFICE')).toBeNull();
  });

  it('the reason code shows only on corrections and opening entries', () => {
    expect(toStatementItem(row({ entryType: 'DEBIT_ORDER', reasonCode: 'SYSTEM_ERROR', ...withOrder }), ctx, 'OFFICE').reasonCode).toBeNull();
    expect(toStatementItem(row({ reasonCode: 'BANK_REVERSAL' }), ctx, 'OFFICE').reasonCode).toBe('BANK_REVERSAL');
    expect(toStatementItem(row({ reasonCode: null }), ctx, 'OFFICE').reasonCode).toBeNull();
  });

  it('a legacy row without a human number gets an empty short code', () => {
    const item = toStatementItem(row({ entryType: 'DEBIT_ORDER', reasonCode: null, orderId: ORDER_ID, order: { id: ORDER_ID, orderNo: null, client: { name: 'Sana' } } }), ctx, 'DISTRIBUTOR');
    expect(item.subject?.shortCode).toBe('');
  });
});

describe('statement date bounds (G12-03: from the day settings)', () => {
  const options = { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' };

  it('a business date covers the whole business day: 03:00 to 03:00 Pakistan time', () => {
    expect(statementBound('2026-10-22', 'from', options)).toEqual({ at: new Date('2026-10-21T22:00:00.000Z'), exclusive: false });
    expect(statementBound('2026-10-22', 'to', options)).toEqual({ at: new Date('2026-10-22T22:00:00.000Z'), exclusive: true });
    expect(statementBound('2026-10-22', 'from', { ...options, cutoffLocalTime: '00:00' }).at).toEqual(new Date('2026-10-21T19:00:00.000Z'));
  });

  it('an instant is used as it is, inclusive', () => {
    expect(statementBound('2026-10-22T10:00:00Z', 'to', options)).toEqual({ at: new Date('2026-10-22T10:00:00.000Z'), exclusive: false });
  });
});

describe('top-up rules (API_CONTRACT §7.9)', () => {
  const limits = { minPaisa: 50_000n, maxPaisa: 5_000_000n };

  it('TOP-003 the limits are inclusive, with the limits in the details', () => {
    expect(() => assertTopupAmount(50_000n, limits)).not.toThrow();
    expect(() => assertTopupAmount(5_000_000n, limits)).not.toThrow();
    const small = thrown(() => assertTopupAmount(49_900n, limits));
    expect([small.code, small.details, small.message]).toEqual([
      'TOPUP_AMOUNT_TOO_SMALL',
      { minPaisa: '50000', maxPaisa: '5000000' },
      'The minimum top-up is Rs 500.',
    ]);
    const large = thrown(() => assertTopupAmount(5_000_100n, limits));
    expect([large.code, large.message]).toEqual(['TOPUP_AMOUNT_TOO_LARGE', 'The maximum top-up is Rs 50,000.']);
  });

  it('TOP-006 the cap counts the balance and the requests being checked; no cap means no limit', () => {
    expect(roomUnderCap(null, 500_000n, 0n)).toBeNull();
    expect(roomUnderCap(1_000_000n, 500_000n, 0n)).toBe(500_000n);
    expect(roomUnderCap(1_000_000n, 500_000n, 500_000n)).toBe(0n);
    expect(roomUnderCap(1_000_000n, 900_000n, 500_000n)).toBe(0n);
    expect(() => assertUnderCap(null, 10n ** 12n, 0n, 10n ** 9n)).not.toThrow();
    expect(() => assertUnderCap(1_000_000n, 500_000n, 0n, 500_000n)).not.toThrow();
    const over = thrown(() => assertUnderCap(1_000_000n, 500_000n, 0n, 600_000n));
    expect([over.code, over.details, over.message]).toEqual([
      'TOPUP_WOULD_EXCEED_CAP',
      { capPaisa: '1000000', maxNowPaisa: '500000' },
      "Your balance can't go above Rs 10,000. You can add up to Rs 5,000 now.",
    ]);
  });

  it('TOP-016 the bank time may be up to 5 minutes ahead of the server clock, no more', () => {
    const now = new Date('2026-10-22T05:00:00.000Z');
    expect(isBankTimeInFuture(new Date('2026-10-22T05:05:00.000Z'), now)).toBe(false);
    expect(isBankTimeInFuture(new Date('2026-10-22T05:05:00.001Z'), now)).toBe(true);
    expect(isBankTimeInFuture(new Date('2026-10-22T05:02:00.000Z'), now)).toBe(false);
    expect(isBankTimeInFuture(new Date('2020-01-01T00:00:00.000Z'), now)).toBe(false);
  });

  it('TOP-013 search: short codes in any case, the normalised reference from 3 characters', () => {
    expect(parseTopupShortCode('ag-t001')).toEqual({ code: 'AG', requestNo: 1 });
    expect(parseTopupShortCode(' AG-T031 ')).toEqual({ code: 'AG', requestNo: 31 });
    expect(parseTopupShortCode('AG-0142')).toBeNull();
    expect(parseTopupShortCode('Raza')).toBeNull();
    const or = (q: string) => (topupSearchWhere(q).OR ?? []) as Prisma.PaymentWhereInput[];
    expect(or('ft 1111')).toContainEqual({ bankReferenceKey: { contains: 'FT1111' } });
    expect(or('ag-t001')).toContainEqual({ requestNo: 1, distributor: { code: 'AG' } });
    expect(or('ab').some((c) => 'bankReferenceKey' in c)).toBe(false);
    expect(or('Raza')).toContainEqual({ payerName: { contains: 'Raza', mode: 'insensitive' } });
  });

  it('the office tabs list fixed statuses; legacy FAILED counts as rejected', () => {
    expect(TAB_STATUSES).toEqual({ 'to-check': ['PENDING'], approved: ['SUCCESS'], rejected: ['REJECTED', 'FAILED'], all: null });
  });
});

describe('PaymentDto words (API_CONTRACT §1.4, §1.6)', () => {
  const base: PaymentRow = {
    id: PAYMENT_ID,
    distributorId: '55555555-5555-4555-8555-555555555555',
    requestNo: 31,
    clientRequestId: null,
    amountPaisa: 500_000n,
    provider: 'BANK_MANUAL',
    providerTxnId: null,
    status: 'PENDING',
    payerName: 'Ahmed Raza',
    payerChannel: 'BANK_APP',
    transactionId: null,
    proofUrl: null,
    proofFileId: null,
    bankReference: null,
    bankReferenceKey: null,
    bankAmountPaisa: null,
    bankReceivedAt: null,
    rejectReasonCode: null,
    rejectNote: null,
    verifiedByUserId: null,
    createdAt: new Date('2026-10-22T05:00:00.000Z'),
    completedAt: null,
    distributor: { id: '55555555-5555-4555-8555-555555555555', businessName: 'Ahmed Gas', code: 'AG' },
    proofFile: null,
  };

  it('stages: being checked, added, not added', () => {
    expect(paymentStage('PENDING')).toBe('BEING_CHECKED');
    expect(paymentStage('SUCCESS')).toBe('ADDED');
    expect(paymentStage('REJECTED')).toBe('NOT_ADDED');
    expect(paymentStage('FAILED')).toBe('NOT_ADDED');
  });

  it('allowed actions: only the office, only while being checked; a gateway request can only be rejected', () => {
    expect(paymentActions(base, 'OFFICE')).toEqual(['APPROVE', 'REJECT']);
    expect(paymentActions({ ...base, provider: 'JAZZCASH' }, 'OFFICE')).toEqual(['REJECT']);
    expect(paymentActions(base, 'DISTRIBUTOR')).toEqual([]);
    expect(paymentActions({ ...base, status: 'SUCCESS' }, 'OFFICE')).toEqual([]);
  });

  it('TOP-018 the credited amount is the bank amount once approved', () => {
    expect(creditedPaisa(base)).toBeNull();
    expect(creditedPaisa({ ...base, status: 'SUCCESS', bankAmountPaisa: 450_000n })).toBe(450_000n);
    expect(creditedPaisa({ ...base, status: 'SUCCESS' })).toBe(500_000n);
  });

  it('TOP-008 the distributor view never carries the office fields', () => {
    const extra = { proofUrl: null, reviewer: { id: USER_ID, name: 'Owner' } };
    const approved = { ...base, status: 'SUCCESS' as const, bankReference: 'FT-1', bankAmountPaisa: 500_000n, completedAt: new Date('2026-10-22T06:00:00.000Z') };
    const shop = toPaymentDto(approved, 'DISTRIBUTOR', extra);
    for (const officeOnly of ['distributor', 'bankReference', 'bankAmountPaisa', 'bankReceivedAt', 'reviewedBy']) expect(shop).not.toHaveProperty(officeOnly);
    expect(shop).toMatchObject({ shortCode: 'AG-T031', stage: 'ADDED', creditedPaisa: '500000', reviewedAt: '2026-10-22T06:00:00.000Z' });
    const office = toPaymentDto(approved, 'OFFICE', extra);
    expect(office).toMatchObject({
      distributor: { businessName: 'Ahmed Gas', code: 'AG' },
      bankReference: 'FT-1',
      bankAmountPaisa: '500000',
      reviewedBy: { id: USER_ID, name: 'Owner' },
    });
  });
});
