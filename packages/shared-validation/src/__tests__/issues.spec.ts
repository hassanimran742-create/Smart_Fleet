import { z } from 'zod';
import {
  parseRequest,
  primaryErrorCode,
  toFieldIssues,
  validationErrorMap,
  VALIDATION_CODES,
  VALIDATION_MESSAGE_EN,
} from '..';

describe('validationErrorMap', () => {
  const schema = z.object({ id: z.string().uuid(), name: z.string().min(2), kind: z.enum(['A', 'B']), when: z.string().datetime() });

  it('names zod issues with validation codes', () => {
    const result = schema.safeParse({ id: 'nope', kind: 'C', when: 'yesterday' }, { errorMap: validationErrorMap });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
        ['id', 'INVALID_ID'],
        ['name', 'REQUIRED'],
        ['kind', 'INVALID_CHOICE'],
        ['when', 'INVALID_DATETIME'],
      ]);
    }
  });

  it('keeps codes set by a schema', () => {
    const coded = z.enum(['X'], { message: 'SCAN_EVENT_NOT_ALLOWED' });
    const result = coded.safeParse('Y', { errorMap: validationErrorMap });
    expect(result.success ? null : result.error.issues[0].message).toBe('SCAN_EVENT_NOT_ALLOWED');
  });

  it('reports unknown keys on strict objects', () => {
    expect(parseRequest(z.object({}).strict(), { extra: 1 })).toEqual({
      success: false,
      errorCode: 'VALIDATION_FAILED',
      fields: [{ path: '', code: 'NOT_ALLOWED' }],
    });
  });
});

describe('toFieldIssues', () => {
  it('derives codes and params even without the error map', () => {
    const result = z.object({ note: z.string().min(3), count: z.number().int().max(5) }).safeParse({ note: 'a', count: 6.5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldIssues(result.error)).toEqual([
        { path: 'note', code: 'TOO_SHORT', params: { min: 3 } },
        { path: 'count', code: 'NOT_INTEGER' },
        { path: 'count', code: 'TOO_LARGE', params: { max: 5 } },
      ]);
    }
  });
});

describe('primaryErrorCode', () => {
  it('promotes a single shared code and nothing else', () => {
    expect(primaryErrorCode([{ path: 'amountPaisa', code: 'AMOUNT_NOT_WHOLE_RUPEES' }])).toBe('AMOUNT_NOT_WHOLE_RUPEES');
    expect(
      primaryErrorCode([
        { path: 'basePaisa', code: 'PRICE_INVALID' },
        { path: 'sizes.0.perCylinderPaisa', code: 'PRICE_INVALID' },
      ]),
    ).toBe('PRICE_INVALID');
    expect(
      primaryErrorCode([
        { path: 'amountPaisa', code: 'AMOUNT_NOT_WHOLE_RUPEES' },
        { path: 'payerName', code: 'REQUIRED' },
      ]),
    ).toBe('VALIDATION_FAILED');
    expect(primaryErrorCode([{ path: 'name', code: 'REQUIRED' }])).toBe('VALIDATION_FAILED');
    expect(primaryErrorCode([])).toBe('VALIDATION_FAILED');
  });
});

describe('VALIDATION_MESSAGE_EN', () => {
  it('has plain English for every code', () => {
    expect(Object.keys(VALIDATION_MESSAGE_EN).sort()).toEqual([...VALIDATION_CODES].sort());
    for (const code of VALIDATION_CODES) expect(VALIDATION_MESSAGE_EN[code]).toMatch(/^[A-Z].*[.]$/);
  });

  it('uses only the parameters issues carry', () => {
    for (const code of VALIDATION_CODES) {
      const params = [...VALIDATION_MESSAGE_EN[code].matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
      for (const param of params) expect(['min', 'max']).toContain(param);
    }
  });
});
