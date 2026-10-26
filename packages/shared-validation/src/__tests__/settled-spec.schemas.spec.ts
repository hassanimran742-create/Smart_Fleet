/**
 * Schemas added or changed by the 2026-10-22 spec reconciliation (docs/pilot/CHANGELOG.md). Each block
 * names the gap it settles.
 */
import { z } from 'zod';
import {
  approveDistributorSchema,
  bulkRegisterSchema,
  clientsQuerySchema,
  createDriverSchema,
  createZoneSchema,
  driverReasonSchema,
  finishStopSchema,
  finishTripSchema,
  manualDeliveryV2Schema,
  newLinkSchema,
  pageQuerySchema,
  parseRequest,
  PRICE_MAX_PAISA,
  refillScanSchema,
  registerPushTokenSchema,
  removePushTokenSchema,
  resolveCaseSchema,
  shareSchema,
  statementQuerySchema,
  storeScanSchema,
  tripScanSchema,
  unlabelledReturnsSchema,
  updateDriverProfileSchema,
  updateTripStatusSchema,
  updateZoneSchema,
  VALIDATION_MESSAGE_EN,
  zonesQuerySchema,
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

describe('G01-10 statement kind filter', () => {
  it('takes one kind or a comma-separated list of distinct kinds and gives a list', () => {
    expect(ok(statementQuerySchema, { kind: 'DELIVERY_COST' }).kind).toEqual(['DELIVERY_COST']);
    expect(ok(statementQuerySchema, { kind: 'DELIVERY_COST, DELIVERY_COST_RETURNED' }).kind).toEqual([
      'DELIVERY_COST',
      'DELIVERY_COST_RETURNED',
    ]);
    expect(ok(statementQuerySchema, { kind: ['TOPUP_ADDED', 'CORRECTION'] }).kind).toEqual(['TOPUP_ADDED', 'CORRECTION']);
    expect(ok(statementQuerySchema, { kind: '' }).kind).toBeUndefined();
    expect(ok(statementQuerySchema, {})).toEqual({ limit: 30 });
  });

  it('refuses an unknown or repeated kind on `kind`', () => {
    expect(fail(statementQuerySchema, { kind: 'REFUND' })).toEqual({
      errorCode: 'VALIDATION_FAILED',
      fields: [{ path: 'kind', code: 'INVALID_CHOICE' }],
    });
    expect(fail(statementQuerySchema, { kind: 'DELIVERY_COST,DELIVERY_COST' }).fields).toEqual([
      { path: 'kind', code: 'DUPLICATE_ITEM' },
    ]);
    expect(fail(statementQuerySchema, { kind: 'DELIVERY_COST,' }).fields).toEqual([{ path: 'kind', code: 'INVALID_CHOICE' }]);
  });
});

describe('G03-02 delivery price bounds', () => {
  it('caps every amount at Rs 100,000 and words PRICE_INVALID with the range', () => {
    expect(PRICE_MAX_PAISA).toBe(10_000_000);
    expect(VALIDATION_MESSAGE_EN.PRICE_INVALID).toBe('Enter whole rupees, from Rs 0 to Rs 100,000.');
  });
});

describe('G03-06 GET /clients query', () => {
  it('takes an optional distributorId for the office', () => {
    expect(ok(clientsQuerySchema, { distributorId: ID })).toEqual({ distributorId: ID });
    expect(ok(clientsQuerySchema, {})).toEqual({});
    expect(fail(clientsQuerySchema, { distributorId: 'nope' }).fields).toEqual([{ path: 'distributorId', code: 'INVALID_ID' }]);
  });
});

describe('G03-10 zone bodies', () => {
  const square = { type: 'MultiPolygon', coordinates: [[[[74.3, 31.5], [74.4, 31.5], [74.4, 31.6], [74.3, 31.6], [74.3, 31.5]]]] };

  it('accepts a MultiPolygon and drops isActive on update', () => {
    expect(ok(createZoneSchema, { cityId: ID, name: ' North ', polygonGeoJson: square })).toEqual({
      cityId: ID,
      name: 'North',
      polygonGeoJson: square,
    });
    expect(ok(updateZoneSchema, { name: 'North 2', isActive: false })).toEqual({ name: 'North 2' });
    expect(ok(zonesQuerySchema, { includeArchived: 'true' })).toEqual({ includeArchived: true });
  });

  it('refuses a short name and a shape that is not a closed MultiPolygon', () => {
    expect(fail(createZoneSchema, { cityId: ID, name: 'N', polygonGeoJson: square }).fields).toEqual([
      { path: 'name', code: 'TOO_SHORT', params: { min: 2 } },
    ]);
    const polygon = { type: 'Polygon', coordinates: square.coordinates[0] };
    expect(fail(createZoneSchema, { cityId: ID, name: 'North', polygonGeoJson: polygon }).fields[0]).toMatchObject({
      path: 'polygonGeoJson.type',
      code: 'INVALID_CHOICE',
    });
    const open = { type: 'MultiPolygon', coordinates: [[[[74.3, 31.5], [74.4, 31.5], [74.4, 31.6], [74.3, 31.6]]]] };
    expect(fail(createZoneSchema, { cityId: ID, name: 'North', polygonGeoJson: open }).errorCode).toBe('VALIDATION_FAILED');
    const offMap = { type: 'MultiPolygon', coordinates: [[[[274.3, 31.5], [74.4, 31.5], [74.4, 31.6], [274.3, 31.5]]]] };
    expect(fail(createZoneSchema, { cityId: ID, name: 'North', polygonGeoJson: offMap }).errorCode).toBe('VALIDATION_FAILED');
    expect(fail(createZoneSchema, { cityId: ID, name: 'North', polygonGeoJson: { type: 'MultiPolygon', coordinates: [] } }).errorCode).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('G05-02 office trip abort reason', () => {
  it('needs 5–300 characters to abort; other moves need none', () => {
    expect(ok(updateTripStatusSchema, { status: 'ABORTED', reason: 'Van broke down' })).toEqual({
      status: 'ABORTED',
      reason: 'Van broke down',
    });
    expect(fail(updateTripStatusSchema, { status: 'ABORTED' }).fields).toEqual([{ path: 'reason', code: 'REQUIRED' }]);
    expect(fail(updateTripStatusSchema, { status: 'ABORTED', reason: 'abc' }).fields).toEqual([
      { path: 'reason', code: 'TOO_SHORT', params: { min: 5 } },
    ]);
    expect(ok(updateTripStatusSchema, { status: 'IN_PROGRESS' })).toEqual({ status: 'IN_PROGRESS' });
  });
});

describe('G05-06, G05-10 scan bodies (Inc 2 and Inc 3)', () => {
  const scan = { scanId: ID, stopId: ID2, action: 'LOAD', code: 'AG-C0042', entryMethod: 'TYPED' };

  it('answers SCAN_RETURN_STATE_REQUIRED for a TAKE_BACK without a state, alone', () => {
    expect(fail(tripScanSchema, { ...scan, action: 'TAKE_BACK' })).toEqual({
      errorCode: 'SCAN_RETURN_STATE_REQUIRED',
      fields: [{ path: 'returnState', code: 'SCAN_RETURN_STATE_REQUIRED' }],
    });
    expect(VALIDATION_MESSAGE_EN.SCAN_RETURN_STATE_REQUIRED).toBe('Choose Empty, Part-filled or Full first.');
    expect(fail(tripScanSchema, { ...scan, action: 'TAKE_BACK', scanId: 'x' }).errorCode).toBe('VALIDATION_FAILED');
    expect(ok(tripScanSchema, { ...scan, action: 'TAKE_BACK', returnState: 'PART_FILLED' }).returnState).toBe('PART_FILLED');
  });

  it('refuses a holder named by the client and drops other unknown fields', () => {
    for (const schema of [tripScanSchema, storeScanSchema, refillScanSchema]) {
      const body = schema === refillScanSchema ? { ...scan, phase: 'PICKUP' } : scan;
      expect(fail(schema, { ...body, toCustodyType: 'STORE' }).fields).toEqual([{ path: 'toCustodyType', code: 'NOT_ALLOWED' }]);
      expect(fail(schema, { ...body, toCustodyId: ID }).fields).toEqual([{ path: 'toCustodyId', code: 'NOT_ALLOWED' }]);
      expect(ok(schema, { ...body, storeId: ID })).not.toHaveProperty('storeId');
    }
  });
});

describe('G05-09 trip finish and G06-01 unlabelled returns (Inc 2)', () => {
  it('needs a leftover reason of 5–300 characters after trimming when one is sent', () => {
    expect(ok(finishTripSchema, {})).toEqual({});
    expect(ok(finishTripSchema, { leftoverReason: ' Store closed early ' })).toEqual({ leftoverReason: 'Store closed early' });
    expect(fail(finishTripSchema, { leftoverReason: '    ' }).fields).toEqual([
      { path: 'leftoverReason', code: 'TOO_SHORT', params: { min: 5 } },
    ]);
  });

  it('takes at most 20 items, counts 0–30, one per size and state', () => {
    expect(ok(unlabelledReturnsSchema, { items: [{ cylinderTypeId: ID, state: 'EMPTY', count: 0 }] }).items).toHaveLength(1);
    const twice = [
      { cylinderTypeId: ID, state: 'EMPTY', count: 1 },
      { cylinderTypeId: ID, state: 'EMPTY', count: 2 },
    ];
    expect(fail(unlabelledReturnsSchema, { items: twice }).fields).toEqual([{ path: 'items.1.state', code: 'DUPLICATE_ITEM' }]);
    expect(fail(unlabelledReturnsSchema, { items: [{ cylinderTypeId: ID, state: 'FULL', count: 31 }] }).fields).toEqual([
      { path: 'items.0.count', code: 'TOO_LARGE', params: { max: 30 } },
    ]);
    const many = Array.from({ length: 21 }, (_, i) => ({ cylinderTypeId: ID, state: 'EMPTY', count: i }));
    expect(fail(unlabelledReturnsSchema, { items: many }).fields[0]).toMatchObject({ path: 'items', code: 'TOO_MANY_ITEMS' });
  });

  it('needs a note to explain a short take-back with OTHER', () => {
    expect(ok(finishStopSchema, {})).toEqual({});
    expect(fail(finishStopSchema, { takeBackShort: { reasonCode: 'OTHER' } }).fields).toEqual([
      { path: 'takeBackShort.note', code: 'NOTE_REQUIRED', params: { min: 3 } },
    ]);
  });
});

describe('G05-12 bulk registration', () => {
  const base = { distributorId: ID, cylinderTypeId: ID2 };

  it('takes a quantity or serials, starts FULL in the home store by default', () => {
    expect(ok(bulkRegisterSchema, { ...base, quantity: 500, initialCustodyType: 'STORE', initialCustodyId: ID })).toEqual({
      ...base,
      quantity: 500,
      state: 'FULL',
      initialCustodyType: 'STORE',
      initialCustodyId: ID,
    });
    expect(ok(bulkRegisterSchema, { ...base, serials: ['AG-0001-QR'], state: 'EMPTY' })).toEqual({
      ...base,
      serials: ['AG-0001-QR'],
      state: 'EMPTY',
    });
  });

  it('refuses more than 500, both or neither, a repeated serial and any other first holder', () => {
    expect(fail(bulkRegisterSchema, { ...base, quantity: 501 }).fields).toEqual([
      { path: 'quantity', code: 'TOO_LARGE', params: { max: 500 } },
    ]);
    expect(fail(bulkRegisterSchema, base).fields).toEqual([{ path: 'quantity', code: 'REQUIRED' }]);
    expect(fail(bulkRegisterSchema, { ...base, quantity: 2, serials: ['AG-1', 'AG-2'] }).fields).toEqual([
      { path: 'serials', code: 'NOT_ALLOWED' },
    ]);
    expect(fail(bulkRegisterSchema, { ...base, serials: ['AG-1', 'AG-1'] }).fields).toEqual([
      { path: 'serials.1', code: 'DUPLICATE_ITEM' },
    ]);
    expect(fail(bulkRegisterSchema, { ...base, quantity: 1, initialCustodyType: 'VEHICLE' }).fields).toEqual([
      { path: 'initialCustodyType', code: 'NOT_ALLOWED' },
    ]);
  });
});

describe('G06-08 manual delivery v2 (Inc 2)', () => {
  it('needs a reason of 10–300, 1–100 named cylinders and at most 100 taken back', () => {
    const body = { reason: 'Store forgot to scan', cylinders: [{ code: 'AG-C0042' }], takenBack: [{ code: '7', returnState: 'EMPTY' }] };
    expect(ok(manualDeliveryV2Schema, body)).toEqual(body);
    expect(fail(manualDeliveryV2Schema, { ...body, cylinders: [] }).fields).toEqual([
      { path: 'cylinders', code: 'TOO_FEW_ITEMS', params: { min: 1 } },
    ]);
    expect(fail(manualDeliveryV2Schema, { ...body, takenBack: [{ code: '7' }] }).fields).toEqual([
      { path: 'takenBack.0.returnState', code: 'REQUIRED' },
    ]);
  });
});

describe('G07-08 and G07-02 confirmation and case bodies (Inc 2)', () => {
  it('reads new-link, share and resolve bodies', () => {
    expect(ok(newLinkSchema, {})).toEqual({});
    expect(ok(newLinkSchema, { send: 'SMS', extra: 1 })).toEqual({ send: 'SMS' });
    expect(fail(newLinkSchema, { send: 'EMAIL' }).fields).toEqual([{ path: 'send', code: 'INVALID_CHOICE' }]);
    expect(ok(shareSchema, { via: 'WHATSAPP' })).toEqual({ via: 'WHATSAPP' });
    expect(fail(shareSchema, {}).fields).toEqual([{ path: 'via', code: 'REQUIRED' }]);
    expect(fail(resolveCaseSchema, { note: 'ok' }).fields).toEqual([{ path: 'note', code: 'TOO_SHORT', params: { min: 5 } }]);
  });
});

describe('G11-07 reactivation and G11-09 driver bodies', () => {
  it('takes an optional reason to approve, required by the service only for a SUSPENDED distributor', () => {
    expect(ok(approveDistributorSchema, undefined)).toEqual({});
    expect(ok(approveDistributorSchema, {})).toEqual({});
    expect(ok(approveDistributorSchema, { reason: 'Paid the dues' })).toEqual({ reason: 'Paid the dues' });
    expect(fail(approveDistributorSchema, { reason: 'ok' }).fields).toEqual([{ path: 'reason', code: 'TOO_SHORT', params: { min: 5 } }]);
  });

  it('reads driver create, profile and reason bodies, with the INVALID_PHONE words ready for the service', () => {
    expect(
      ok(createDriverSchema, { name: ' Imran ', phone: '0300 1234567', licenceNo: 'LHR-123', email: '', cnic: '35202-1234567-1' }),
    ).toEqual({ name: 'Imran', phone: '0300 1234567', licenceNo: 'LHR-123', cnic: '3520212345671' });
    expect(ok(updateDriverProfileSchema, { email: null, cnic: '', profilePictureUrl: '' })).toEqual({
      email: null,
      cnic: null,
      profilePictureUrl: null,
    });
    expect(ok(updateDriverProfileSchema, { name: 'Imran K', phone: '0300' })).toEqual({ name: 'Imran K' });
    expect(fail(driverReasonSchema, {}).fields).toEqual([{ path: 'reason', code: 'REQUIRED' }]);
    expect(VALIDATION_MESSAGE_EN.INVALID_PHONE).toBe('Enter a mobile number like 0300 1234567.');
  });
});

describe('G11-18 push-token bodies', () => {
  it('needs a token of 1–200 characters', () => {
    expect(ok(registerPushTokenSchema, { token: 'ExponentPushToken[abc]', platform: 'android' })).toEqual({
      token: 'ExponentPushToken[abc]',
      platform: 'android',
    });
    expect(fail(removePushTokenSchema, { token: 'x'.repeat(201) }).fields).toEqual([
      { path: 'token', code: 'TOO_LONG', params: { max: 200 } },
    ]);
  });
});

describe('G15-07 page limits are never clamped', () => {
  it('refuses a limit outside 1–100 or not a whole number', () => {
    expect(fail(pageQuerySchema, { limit: '0' }).fields).toEqual([{ path: 'limit', code: 'TOO_SMALL', params: { min: 1 } }]);
    expect(fail(pageQuerySchema, { limit: '101' }).fields).toEqual([{ path: 'limit', code: 'TOO_LARGE', params: { max: 100 } }]);
    expect(fail(pageQuerySchema, { limit: '2.5' }).fields).toEqual([{ path: 'limit', code: 'NOT_INTEGER' }]);
    expect(fail(pageQuerySchema, { limit: 'many' }).fields).toEqual([{ path: 'limit', code: 'INVALID_TYPE' }]);
  });
});
