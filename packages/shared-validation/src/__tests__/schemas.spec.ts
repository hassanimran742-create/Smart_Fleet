import { z } from 'zod';
import {
  adminTopupsQuerySchema,
  approveTopupSchema,
  cancelOrderSchema,
  changePasswordSchema,
  createClientSchema,
  createDistributorSchema,
  createExpenseSchema,
  createExpenseTypeSchema,
  createFillingOrderSchema,
  createOrderSchema,
  custodyScanSchema,
  expensesQuerySchema,
  failOrderSchema,
  fileUploadSchema,
  loginSchema,
  manualDeliverySchema,
  normalizeBankReference,
  officeCancelOrderSchema,
  officeFailOrderSchema,
  pageQuerySchema,
  paisaSchema,
  parseRequest,
  patchSettingSchema,
  putPriceSchema,
  rejectTopupSchema,
  scanEventSchema,
  toExpenseTypeNameKey,
  topupRequestSchema,
  topupSchema,
  updateDistributorStoreSchema,
  updateExpenseSchema,
  updateMeSchema,
  updateOrderStatusSchema,
  verifyPaymentSchema,
  voidExpenseSchema,
  walletCorrectionSchema,
  type FieldIssue,
} from '..';

const ID = '3f2b8c1e-9a4d-4e2b-8f6a-1c2d3e4f5a6b';
const ID2 = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';

function ok<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = parseRequest(schema, input);
  if (!result.success) throw new Error(`expected success, got ${JSON.stringify(result.fields)}`);
  return result.data;
}

function fail(schema: z.ZodTypeAny, input: unknown): { errorCode: string; fields: FieldIssue[] } {
  const result = parseRequest(schema, input);
  if (result.success) throw new Error(`expected failure, got ${JSON.stringify(result.data)}`);
  return { errorCode: result.errorCode, fields: result.fields };
}

describe('auth', () => {
  it('accepts a phone in any form and never trims passwords', () => {
    expect(ok(loginSchema, { phone: ' 0300 1234567 ', password: ' secret ' })).toEqual({
      phone: '0300 1234567',
      password: ' secret ',
    });
    expect(fail(loginSchema, { phone: '03001234567' }).fields).toEqual([{ path: 'password', code: 'REQUIRED' }]);
  });

  it('needs a new password of 8 characters', () => {
    expect(fail(changePasswordSchema, { currentPassword: 'old', newPassword: 'short' }).fields).toEqual([
      { path: 'newPassword', code: 'TOO_SHORT', params: { min: 8 } },
    ]);
  });

  it('keeps office-only profile fields so the service can refuse them', () => {
    expect(ok(updateMeSchema, { name: 'Ali', phone: '03001234567', email: '' })).toEqual({
      name: 'Ali',
      phone: '03001234567',
      email: null,
    });
  });
});

describe('customers', () => {
  it('still accepts the installed app body', () => {
    const body = {
      name: 'Ahmed Khan',
      phone: '0300 1234567',
      address: 'House 14, Street 5',
      area: '',
      city: 'Islamabad',
      creditLimitRs: 0,
      priority: 1,
      notes: '',
    };
    expect(ok(createClientSchema, body)).toEqual({
      name: 'Ahmed Khan',
      phone: '0300 1234567',
      legacyAddressText: 'House 14, Street 5',
    });
  });

  it('accepts the new address object and points at its broken field', () => {
    expect(ok(createClientSchema, { name: 'A', phone: '1', address: { label: 'Home', lat: 33.7, lng: 73.1 } })).toEqual({
      name: 'A',
      phone: '1',
      address: { label: 'Home', lat: 33.7, lng: 73.1 },
    });
    expect(fail(createClientSchema, { name: 'A', phone: '1', address: { label: 'Home', lat: 33.7 } }).fields).toEqual([
      { path: 'address.lng', code: 'REQUIRED' },
    ]);
  });
});

describe('distributors', () => {
  const store = { name: 'Ali Gas store', address: 'G-9 Markaz', lat: 33.69, lng: 73.03 };

  it('normalises the code, CNIC and email', () => {
    expect(
      ok(createDistributorSchema, {
        phone: '03001234567',
        name: 'Ali',
        businessName: 'Ali Gas',
        code: ' AG ',
        cnic: '35202-1234567-1',
        email: 'Ali@Example.COM',
        store,
      }),
    ).toMatchObject({ code: 'AG', cnic: '3520212345671', email: 'ali@example.com' });
  });

  it('answers DISTRIBUTOR_CODE_INVALID for a bad code alone', () => {
    const result = fail(createDistributorSchema, { phone: '1', name: 'A', businessName: 'B', code: '1AG', store });
    expect(result.errorCode).toBe('DISTRIBUTOR_CODE_INVALID');
    expect(fail(createDistributorSchema, { phone: '1', name: 'A', businessName: 'B', code: 'TOOLONG', store }).errorCode).toBe(
      'DISTRIBUTOR_CODE_INVALID',
    );
    // Capitals only (API_CONTRACT §7.3 rule 2, OFF-005): a lower-case code is refused, not upper-cased.
    expect(fail(createDistributorSchema, { phone: '1', name: 'A', businessName: 'B', code: 'cg', store }).errorCode).toBe(
      'DISTRIBUTOR_CODE_INVALID',
    );
  });

  it('checks the CNIC and the store pin', () => {
    expect(fail(createDistributorSchema, { phone: '1', name: 'A', businessName: 'B', cnic: '123', store }).fields).toEqual([
      { path: 'cnic', code: 'INVALID_CNIC' },
    ]);
    expect(fail(updateDistributorStoreSchema, { lat: 33.7 }).fields).toEqual([{ path: 'lng', code: 'INVALID_LOCATION' }]);
  });
});

describe('orders', () => {
  const installed = {
    clientId: ID,
    deliveryLabel: 'House 14 · F-7',
    deliveryLocation: { lat: 33.72, lng: 73.05 },
    lines: [{ cylinderTypeId: ID2, fullCount: 2, expectedReturnCount: 2 }],
  };

  it('still accepts the installed app body', () => {
    expect(ok(createOrderSchema, installed)).toEqual(installed);
  });

  it('accepts a saved address and the quoted cost', () => {
    const { deliveryLocation: _pin, ...rest } = installed;
    expect(ok(createOrderSchema, { ...rest, addressId: ID, quotedTotalPaisa: 33000, note: '' })).toEqual({
      ...rest,
      addressId: ID,
      quotedTotalPaisa: '33000',
    });
  });

  it('needs exactly one delivery spot', () => {
    const { deliveryLocation: _pin, ...noSpot } = installed;
    expect(fail(createOrderSchema, noSpot).fields).toEqual([{ path: 'deliveryLocation', code: 'INVALID_LOCATION' }]);
    expect(fail(createOrderSchema, { ...installed, addressId: ID }).fields).toEqual([
      { path: 'deliveryLocation', code: 'INVALID_LOCATION' },
    ]);
  });

  it('answers ORDER_LINES_INVALID for bad lines', () => {
    expect(fail(createOrderSchema, { ...installed, lines: [] }).errorCode).toBe('ORDER_LINES_INVALID');
    const twice = [installed.lines[0], installed.lines[0]];
    expect(fail(createOrderSchema, { ...installed, lines: twice }).fields).toEqual([
      { path: 'lines.1.cylinderTypeId', code: 'ORDER_LINES_INVALID' },
    ]);
    const empty = [{ cylinderTypeId: ID2, fullCount: 0, expectedReturnCount: 0 }];
    expect(fail(createOrderSchema, { ...installed, lines: empty }).errorCode).toBe('ORDER_LINES_INVALID');
  });

  it('caps a line at 100 (the order total is the setting) and orders the window', () => {
    const atCap = [{ cylinderTypeId: ID2, fullCount: 100, expectedReturnCount: 100 }];
    expect(ok(createOrderSchema, { ...installed, lines: atCap }).lines).toEqual(atCap);
    const big = [{ cylinderTypeId: ID2, fullCount: 101, expectedReturnCount: 101 }];
    expect(fail(createOrderSchema, { ...installed, lines: big }).fields).toEqual([
      { path: 'lines.0.fullCount', code: 'TOO_LARGE', params: { max: 100 } },
      { path: 'lines.0.expectedReturnCount', code: 'TOO_LARGE', params: { max: 100 } },
    ]);
    const window = { scheduledWindowStart: '2025-10-21T12:00:00Z', scheduledWindowEnd: '2025-10-21T11:00:00+05:00' };
    expect(fail(createOrderSchema, { ...installed, ...window }).fields).toEqual([
      { path: 'scheduledWindowEnd', code: 'END_BEFORE_START' },
    ]);
  });

  it('needs a note for OTHER and always for the office', () => {
    expect(ok(cancelOrderSchema, { reasonCode: 'CUSTOMER_CANCELLED', note: '', confirmRefundPaisa: '33000' })).toEqual({
      reasonCode: 'CUSTOMER_CANCELLED',
      confirmRefundPaisa: '33000',
    });
    expect(fail(cancelOrderSchema, { reasonCode: 'OTHER' }).fields).toEqual([
      { path: 'note', code: 'NOTE_REQUIRED', params: { min: 3 } },
    ]);
    expect(fail(officeCancelOrderSchema, { reasonCode: 'DUPLICATE', note: 'dup' }).fields).toEqual([
      { path: 'note', code: 'TOO_SHORT', params: { min: 5 } },
    ]);
    expect(fail(cancelOrderSchema, { reasonCode: 'CHANGED_MIND' }).fields).toEqual([
      { path: 'reasonCode', code: 'INVALID_CHOICE' },
    ]);
  });

  it('checks could-not-deliver bodies', () => {
    expect(ok(failOrderSchema, { reasonCode: 'CUSTOMER_NOT_HOME', lat: 33.7, lng: 73.1 })).toEqual({
      reasonCode: 'CUSTOMER_NOT_HOME',
      lat: 33.7,
      lng: 73.1,
    });
    expect(fail(failOrderSchema, { reasonCode: 'VAN_PROBLEM', lat: 33.7 }).fields).toEqual([
      { path: 'lng', code: 'INVALID_LOCATION' },
    ]);
    expect(fail(officeFailOrderSchema, { reasonCode: 'VAN_PROBLEM' }).fields).toEqual([{ path: 'note', code: 'REQUIRED' }]);
  });

  it('checks office actions and the legacy status body', () => {
    expect(fail(manualDeliverySchema, { reason: 'too short' }).fields).toEqual([
      { path: 'reason', code: 'TOO_SHORT', params: { min: 10 } },
    ]);
    expect(ok(updateOrderStatusSchema, { status: 'DELIVERED' })).toEqual({ status: 'DELIVERED' });
    expect(ok(updateOrderStatusSchema, { status: 'FAILED', reasonCode: 'CUSTOMER_REFUSED' })).toMatchObject({
      reasonCode: 'CUSTOMER_REFUSED',
    });
  });
});

describe('top-ups', () => {
  const request = { amountPaisa: 500000, payerName: 'Ali Raza', payerChannel: 'EASYPAISA_APP' };

  it('accepts a request and returns paisa as a digit string', () => {
    expect(ok(topupRequestSchema, { ...request, transactionId: '', proofFileId: null })).toEqual({
      ...request,
      amountPaisa: '500000',
    });
    expect(ok(topupRequestSchema, { ...request, amountPaisa: '500000', transactionId: 'TID-77814402' })).toMatchObject({
      amountPaisa: '500000',
      transactionId: 'TID-77814402',
    });
  });

  it('answers AMOUNT_NOT_WHOLE_RUPEES for paisa alone', () => {
    expect(fail(topupRequestSchema, { ...request, amountPaisa: 500050 }).errorCode).toBe('AMOUNT_NOT_WHOLE_RUPEES');
  });

  it('reports field problems', () => {
    expect(fail(topupRequestSchema, { ...request, amountPaisa: 0 }).fields).toEqual([
      { path: 'amountPaisa', code: 'AMOUNT_TOO_SMALL', params: { minPaisa: '100' } },
    ]);
    expect(fail(topupRequestSchema, { ...request, amountPaisa: 12.5 }).fields).toEqual([
      { path: 'amountPaisa', code: 'INVALID_AMOUNT' },
    ]);
    expect(fail(topupRequestSchema, { ...request, transactionId: 'TID 778' }).fields).toEqual([
      { path: 'transactionId', code: 'INVALID_FORMAT' },
    ]);
    expect(fail(topupRequestSchema, { ...request, payerChannel: 'CASH' }).fields).toEqual([
      { path: 'payerChannel', code: 'INVALID_CHOICE' },
    ]);
    expect(fail(topupRequestSchema, { payerName: 'Ali Raza', payerChannel: 'BANK_APP' }).fields).toEqual([
      { path: 'amountPaisa', code: 'REQUIRED' },
    ]);
  });

  it('normalises the bank reference into its key', () => {
    expect(
      ok(approveTopupSchema, { bankReference: ' ft-7781 4402 ', bankAmountPaisa: '450000', bankTime: '2025-10-21T16:12:00+05:00' }),
    ).toEqual({
      bankReference: 'ft-7781 4402',
      bankReferenceKey: 'FT77814402',
      bankAmountPaisa: '450000',
      bankTime: '2025-10-21T16:12:00+05:00',
    });
    expect(normalizeBankReference('ab-12/cd')).toBe('AB12CD');
  });

  it('answers TOPUP_BANK_REFERENCE_REQUIRED for a missing or short reference', () => {
    const rest = { bankAmountPaisa: 450000, bankTime: '2025-10-21T11:12:00Z' };
    expect(fail(approveTopupSchema, { ...rest, bankReference: 'a-b' }).errorCode).toBe('TOPUP_BANK_REFERENCE_REQUIRED');
    expect(fail(approveTopupSchema, rest).errorCode).toBe('TOPUP_BANK_REFERENCE_REQUIRED');
    expect(fail(approveTopupSchema, { ...rest, bankReference: 'X'.repeat(41) }).errorCode).toBe(
      'TOPUP_BANK_REFERENCE_REQUIRED',
    );
    expect(fail(approveTopupSchema, { bankReference: 'FT778', bankAmountPaisa: 450000 }).fields).toEqual([
      { path: 'bankTime', code: 'REQUIRED' },
    ]);
  });

  it('needs a note to reject with OTHER', () => {
    expect(fail(rejectTopupSchema, { reasonCode: 'OTHER', note: '  ' }).fields).toEqual([
      { path: 'note', code: 'NOTE_REQUIRED', params: { min: 3 } },
    ]);
    expect(ok(rejectTopupSchema, { reasonCode: 'NOT_IN_BANK' })).toEqual({ reasonCode: 'NOT_IN_BANK' });
  });

  it('keeps the legacy bodies working', () => {
    expect(ok(topupSchema, { amountPaisa: 500000, provider: 'BANK_MANUAL' })).toEqual({
      amountPaisa: '500000',
      provider: 'BANK_MANUAL',
    });
    expect(fail(verifyPaymentSchema, { approve: 'true' }).fields).toEqual([{ path: 'approve', code: 'INVALID_TYPE' }]);
    expect(ok(adminTopupsQuerySchema, {})).toEqual({ tab: 'to-check', limit: 30 });
  });
});

describe('wallet corrections', () => {
  const body = { direction: 'ADD', amountPaisa: 33000, reasonCode: 'SYSTEM_ERROR', note: 'Charged twice by a bug' };

  it('accepts a correction up to Rs 100,000', () => {
    expect(ok(walletCorrectionSchema, { ...body, amountPaisa: 10000000, relatedOrderId: '' })).toEqual({
      ...body,
      amountPaisa: '10000000',
    });
  });

  it('refuses too much, paisa and a short note', () => {
    expect(fail(walletCorrectionSchema, { ...body, amountPaisa: 10000100 }).fields).toEqual([
      { path: 'amountPaisa', code: 'AMOUNT_TOO_LARGE', params: { maxPaisa: '10000000' } },
    ]);
    expect(fail(walletCorrectionSchema, { ...body, amountPaisa: 33050 }).errorCode).toBe('AMOUNT_NOT_WHOLE_RUPEES');
    expect(fail(walletCorrectionSchema, { ...body, note: 'mistake' }).fields).toEqual([
      { path: 'note', code: 'TOO_SHORT', params: { min: 10 } },
    ]);
  });
});

describe('delivery prices', () => {
  it('accepts one delivery cost per order, Rs 0 and more', () => {
    expect(ok(putPriceSchema, { basePaisa: 0 })).toEqual({ basePaisa: '0' });
    expect(ok(putPriceSchema, { basePaisa: '25000', note: 'Pilot price' })).toEqual({ basePaisa: '25000', note: 'Pilot price' });
  });

  it('answers PRICE_INVALID for negative, part-rupee or too large amounts (Rs 0 to Rs 100,000)', () => {
    expect(ok(putPriceSchema, { basePaisa: 10000000 })).toEqual({ basePaisa: '10000000' });
    expect(fail(putPriceSchema, { basePaisa: 10000100 }).errorCode).toBe('PRICE_INVALID');
    expect(fail(putPriceSchema, { basePaisa: -100 }).errorCode).toBe('PRICE_INVALID');
    expect(fail(putPriceSchema, { basePaisa: 25050 }).errorCode).toBe('PRICE_INVALID');
    expect(fail(putPriceSchema, { basePaisa: 'abc' }).errorCode).toBe('PRICE_INVALID');
    expect(fail(putPriceSchema, {}).fields).toEqual([{ path: 'basePaisa', code: 'REQUIRED' }]);
  });

  it('refuses per-size amounts: the cost is one amount per order, whatever the cylinders', () => {
    expect(fail(putPriceSchema, { basePaisa: 25000, sizes: [{ cylinderTypeId: ID, perCylinderPaisa: 4000 }] })).toEqual({
      errorCode: 'VALIDATION_FAILED',
      fields: [{ path: 'sizes', code: 'NOT_ALLOWED' }],
    });
    expect(fail(putPriceSchema, { basePaisa: 25000, sizes: [] }).fields).toEqual([{ path: 'sizes', code: 'NOT_ALLOWED' }]);
  });
});

describe('expenses', () => {
  const body = { expenseDate: '2025-10-21', amountPaisa: 250000, typeId: ID, description: 'Petrol for LEA-1234' };

  it('accepts an expense and drops blank links', () => {
    expect(ok(createExpenseSchema, { ...body, vehicleId: '', driverId: null })).toEqual({ ...body, amountPaisa: '250000' });
  });

  it('checks the date, the amount and the note', () => {
    expect(fail(createExpenseSchema, { ...body, expenseDate: '2025-02-29' }).fields).toEqual([
      { path: 'expenseDate', code: 'INVALID_DATE' },
    ]);
    expect(fail(createExpenseSchema, { ...body, amountPaisa: 100000100 }).fields).toEqual([
      { path: 'amountPaisa', code: 'AMOUNT_TOO_LARGE', params: { maxPaisa: '100000000' } },
    ]);
    expect(fail(createExpenseSchema, { ...body, description: ' ' }).fields).toEqual([
      { path: 'description', code: 'REQUIRED' },
    ]);
  });

  it('clears links on update with null', () => {
    expect(ok(updateExpenseSchema, { vehicleId: null, receiptFileId: '' })).toEqual({ vehicleId: null, receiptFileId: null });
    expect(ok(updateExpenseSchema, {})).toEqual({});
  });

  it('checks voids, type names and filters', () => {
    expect(fail(voidExpenseSchema, { reason: 'dup' }).fields).toEqual([{ path: 'reason', code: 'TOO_SHORT', params: { min: 5 } }]);
    expect(fail(createExpenseTypeSchema, { name: 'X' }).fields).toEqual([{ path: 'name', code: 'TOO_SHORT', params: { min: 2 } }]);
    expect(toExpenseTypeNameKey('  Toll /  Parking ')).toBe('toll / parking');
    expect(ok(expensesQuerySchema, { from: '2025-10-01', to: '2025-10-31', includeVoided: 'true' })).toEqual({
      from: '2025-10-01',
      to: '2025-10-31',
      includeVoided: true,
      limit: 30,
    });
    expect(fail(expensesQuerySchema, { from: '2025-10-31', to: '2025-10-01' }).fields).toEqual([
      { path: 'to', code: 'END_BEFORE_START' },
    ]);
  });
});

describe('legacy custody scan', () => {
  const scan = { qrCode: 'SF-CYL-000123', eventType: 'SCAN_OUT', tripId: ID };

  it('accepts the installed app body', () => {
    expect(ok(custodyScanSchema, scan)).toEqual(scan);
    expect(ok(scanEventSchema, { ...scan, eventType: 'DELIVERED', orderId: ID2 })).toMatchObject({ orderId: ID2 });
  });

  it('answers SCAN_EVENT_NOT_ALLOWED for any other move', () => {
    expect(fail(custodyScanSchema, { ...scan, eventType: 'RETURNED_TO_DISTRIBUTOR' }).errorCode).toBe('SCAN_EVENT_NOT_ALLOWED');
  });

  it('refuses a destination from the client and needs the order for a hand-over', () => {
    expect(fail(custodyScanSchema, { ...scan, toCustodyType: 'CLIENT', toCustodyId: ID2 }).fields).toEqual([
      { path: 'toCustodyType', code: 'NOT_ALLOWED' },
      { path: 'toCustodyId', code: 'NOT_ALLOWED' },
    ]);
    expect(fail(custodyScanSchema, { ...scan, eventType: 'PICKED_UP_EMPTY' }).fields).toEqual([
      { path: 'orderId', code: 'REQUIRED' },
    ]);
    expect(fail(custodyScanSchema, { ...scan, tripId: undefined }).fields).toEqual([{ path: 'tripId', code: 'REQUIRED' }]);
  });
});

describe('refills', () => {
  it('accepts the installed request and lets DIY through to the 410', () => {
    const body = { fillingStationId: ID, cylinderTypeId: ID2, requestedCount: 10, serviceType: 'OUR_SERVICE' };
    expect(ok(createFillingOrderSchema, body)).toEqual(body);
    const diy = { cylinderTypeId: ID2, requestedCount: 5, serviceType: 'DIY', ownStationName: 'My station' };
    expect(ok(createFillingOrderSchema, diy)).toEqual({ cylinderTypeId: ID2, requestedCount: 5, serviceType: 'DIY' });
  });

  it('needs a station and a sensible count', () => {
    expect(fail(createFillingOrderSchema, { cylinderTypeId: ID2, requestedCount: 5 }).fields).toEqual([
      { path: 'fillingStationId', code: 'REQUIRED' },
    ]);
    expect(fail(createFillingOrderSchema, { fillingStationId: ID, cylinderTypeId: ID2, requestedCount: 0 }).errorCode).toBe(
      'REFILL_INVALID_COUNT',
    );
    expect(fail(createFillingOrderSchema, { fillingStationId: ID, cylinderTypeId: ID2, requestedCount: 1.5 }).errorCode).toBe(
      'REFILL_INVALID_COUNT',
    );
  });
});

describe('settings, files and paging', () => {
  it('needs a value (null is one) and a reason', () => {
    expect(ok(patchSettingSchema, { value: null, reason: 'No cap for the pilot' })).toEqual({
      value: null,
      reason: 'No cap for the pilot',
    });
    expect(fail(patchSettingSchema, { reason: 'No cap for the pilot' }).fields).toEqual([{ path: 'value', code: 'REQUIRED' }]);
  });

  it('reads the upload purpose', () => {
    expect(ok(fileUploadSchema, { purpose: 'EXPENSE_RECEIPT' })).toEqual({ purpose: 'EXPENSE_RECEIPT' });
    expect(ok(fileUploadSchema, { purpose: '' })).toEqual({});
    expect(fail(fileUploadSchema, { purpose: 'SELFIE' }).fields).toEqual([{ path: 'purpose', code: 'INVALID_CHOICE' }]);
  });

  it('coerces and bounds the page size', () => {
    expect(ok(pageQuerySchema, { limit: '50', cursor: 'abc' })).toEqual({ limit: 50, cursor: 'abc' });
    expect(ok(pageQuerySchema, {})).toEqual({ limit: 30 });
    expect(fail(pageQuerySchema, { limit: '101' }).fields).toEqual([{ path: 'limit', code: 'TOO_LARGE', params: { max: 100 } }]);
  });
});

describe('paisaSchema', () => {
  it('returns canonical digit strings', () => {
    expect(ok(paisaSchema(), '000500')).toBe('500');
    expect(ok(paisaSchema(), 0)).toBe('0');
    expect(fail(paisaSchema(), '1e5').fields).toEqual([{ path: '', code: 'INVALID_AMOUNT' }]);
    expect(fail(paisaSchema(), '9007199254740993').fields).toEqual([{ path: '', code: 'INVALID_AMOUNT' }]);
    expect(fail(paisaSchema(), null).fields).toEqual([{ path: '', code: 'REQUIRED' }]);
  });
});
