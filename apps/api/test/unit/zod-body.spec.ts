import { ValidationPipe } from '@nestjs/common';
import { ERROR_HTTP } from '@smartfleet/shared-types';
import { custodyScanSchema, patchSettingSchema, topupRequestSchema } from '@smartfleet/shared-validation';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { z } from 'zod';
import { AppError } from '../../src/common/errors/app-error';
import { createValidationPipe, fieldErrorsFromClassValidator } from '../../src/common/pipes/validation.pipe';
import { ZodBody, ZodQuery } from '../../src/common/pipes/zod-body.pipe';
import { auditLogsQuerySchema } from '../../src/modules/audit-log/audit-log.controller';

function failure(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the pipe to throw');
}

const TRIP = '5b0c1c39-8f3e-4d5f-9c43-2f6c7d8e9a10';

describe('ZodBody (API_CONTRACT §2.2)', () => {
  it("returns the schema's output: trimmed text and canonical paisa strings", () => {
    const pipe = new ZodBody(topupRequestSchema);
    expect(pipe.transform({ amountPaisa: 500000, payerName: '  Ali Raza ', payerChannel: 'BANK_APP', transactionId: '' })).toEqual({
      amountPaisa: '500000',
      payerName: 'Ali Raza',
      payerChannel: 'BANK_APP',
    });
  });

  it('answers VALIDATION_FAILED with details.fields [{ path, code, message, params }]', () => {
    const error = failure(() => new ZodBody(patchSettingSchema).transform({ reason: 'no' }));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.getStatus()).toBe(400);
    expect(error.details.fields).toEqual(
      expect.arrayContaining([
        { path: 'value', code: 'REQUIRED', message: 'Fill this in.' },
        { path: 'reason', code: 'TOO_SHORT', message: 'Use at least 5 characters.', params: { min: 5 } },
      ]),
    );
    for (const field of error.details.fields ?? []) expect(field.message).not.toMatch(/\{\{/);
  });

  it('answers the promoted code when it is the only problem (AMOUNT_NOT_WHOLE_RUPEES)', () => {
    const error = failure(() =>
      new ZodBody(topupRequestSchema).transform({ amountPaisa: '500050', payerName: 'Ali', payerChannel: 'BANK_APP' }),
    );
    expect(error.code).toBe('AMOUNT_NOT_WHOLE_RUPEES');
    expect(error.getStatus()).toBe(ERROR_HTTP.AMOUNT_NOT_WHOLE_RUPEES);
    expect(error.details.fields).toEqual([
      { path: 'amountPaisa', code: 'AMOUNT_NOT_WHOLE_RUPEES', message: 'Enter whole rupees, with no paisa.' },
    ]);
  });

  it('answers 403 SCAN_EVENT_NOT_ALLOWED for a refused legacy scan event', () => {
    const error = failure(() =>
      new ZodBody(custodyScanSchema).transform({ qrCode: 'CYL-0001', eventType: 'RETURNED_TO_DISTRIBUTOR', tripId: TRIP }),
    );
    expect(error.code).toBe('SCAN_EVENT_NOT_ALLOWED');
    expect(error.getStatus()).toBe(403);
  });

  it('falls back to VALIDATION_FAILED when problems differ', () => {
    const error = failure(() => new ZodBody(topupRequestSchema).transform({ amountPaisa: '500050', payerChannel: 'X' }));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details.fields?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps every field message free of raw placeholders', () => {
    const schema = z.object({ note: z.string().refine(() => false, 'TOO_SHORT') });
    const error = failure(() => new ZodBody(schema).transform({ note: 'x' }));
    expect(error.details.fields?.[0]).toMatchObject({ path: 'note', code: 'TOO_SHORT', message: 'Check this value.' });
  });

  it('works on query strings, coercing and defaulting (ZodQuery)', () => {
    const query = new ZodQuery(auditLogsQuerySchema).transform({ limit: '50', action: ' order.cancel ', from: '2026-10-21' });
    expect(query).toMatchObject({ limit: 50, action: 'order.cancel', from: '2026-10-21' });
    expect(new ZodQuery(auditLogsQuerySchema).transform({})).toMatchObject({ limit: 30 });
    expect(failure(() => new ZodQuery(auditLogsQuerySchema).transform({ limit: '500' })).code).toBe('VALIDATION_FAILED');
    expect(failure(() => new ZodQuery(auditLogsQuerySchema).transform({ resourceId: 'abc' })).code).toBe('VALIDATION_FAILED');
  });
});

class LegacyDto {
  @IsString()
  @MaxLength(5)
  name!: string;

  @IsInt()
  @Min(2)
  count!: number;
}

describe('class-validator DTOs share the format (global ValidationPipe)', () => {
  it('answers VALIDATION_FAILED with paths, codes, English and bounds', async () => {
    const pipe: ValidationPipe = createValidationPipe();
    const error = await pipe
      .transform({ name: 'far too long', count: 1, extra: true }, { type: 'body', metatype: LegacyDto })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe('VALIDATION_FAILED');
    expect(appError.details.fields).toEqual(
      expect.arrayContaining([
        { path: 'name', code: 'TOO_LONG', message: 'Use at most 5 characters.', params: { max: 5 } },
        { path: 'count', code: 'TOO_SMALL', message: 'Enter 2 or more.', params: { min: 2 } },
        { path: 'extra', code: 'NOT_ALLOWED', message: expect.any(String) },
      ]),
    );
  });

  it('dots nested paths and maps unknown constraints to INVALID_VALUE', () => {
    expect(
      fieldErrorsFromClassValidator([
        {
          property: 'store',
          children: [{ property: 'lat', constraints: { isLatitude: 'lat must be a latitude string or number' }, children: [] }],
        },
      ]),
    ).toEqual([{ path: 'store.lat', code: 'INVALID_VALUE', message: 'Check this value.' }]);
  });
});
