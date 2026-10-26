/**
 * REV23 robustness-jobs-02: a lone UTF-16 surrogate (half an emoji) in a body used to reach Prisma, whose
 * query engine refuses the whole query ("lone leading surrogate in hex escape"), and answer 500
 * INTERNAL_ERROR (API_CONTRACT §2.2: bad input is VALIDATION_FAILED). The shared text schemas now refuse it
 * as INVALID_VALUE, as they refuse a NUL; free text that is cleaned (the customer's comment, the day-end
 * "Why different") keeps a U+FFFD instead; and an engine refusal that still happens maps to 400 at warn.
 */
import { Prisma } from '@prisma/client';
import { cleanDaySheetReason } from '@smartfleet/shared-utils';
import {
  cleanCustomerComment,
  cylinderCodeSchema,
  isStorableText,
  isWellFormedText,
  optionalTextSchema,
  parseRequest,
  reasonSchema,
  textSchema,
  toWellFormedText,
} from '@smartfleet/shared-validation';
import { z } from 'zod';
import { toApiError } from '../../src/common/errors/error-mapping';

const LONE_LEAD = 'Driver forgot \ud83d the label';
const LONE_TRAIL = 'Driver forgot \ude00 the label';
const EMOJI = 'Driver forgot 😀 the label';

describe('REV23 robustness-jobs-02 text with a lone surrogate', () => {
  it('REV23 robustness-jobs-02 is not well-formed; whole emoji, Urdu and plain text are', () => {
    expect([LONE_LEAD, LONE_TRAIL, 'x\ud800', '\udfff', '\ud83d😀'].map(isWellFormedText)).toEqual([false, false, false, false, false]);
    expect([EMOJI, 'سلنڈر واپس', 'AG-C0042', ''].map(isWellFormedText)).toEqual([true, true, true, true]);
    expect(isStorableText('a\u0000b')).toBe(false);
    expect(isStorableText(EMOJI)).toBe(true);
  });

  it('REV23 robustness-jobs-02 the shared text schemas refuse it with INVALID_VALUE (scan codes, notes, reasons)', () => {
    const body = z.object({ code: cylinderCodeSchema, name: textSchema(1, 80), note: optionalTextSchema(300), reason: reasonSchema });
    expect(parseRequest(body, { code: 'STD_11_8KG-\ud800', name: 'Sana \ud83d', note: LONE_TRAIL, reason: LONE_LEAD })).toEqual({
      success: false,
      errorCode: 'VALIDATION_FAILED',
      fields: [
        { path: 'code', code: 'INVALID_VALUE' },
        { path: 'name', code: 'INVALID_VALUE' },
        { path: 'note', code: 'INVALID_VALUE' },
        { path: 'reason', code: 'INVALID_VALUE' },
      ],
    });
    expect(parseRequest(body, { code: 'STD_11_8KG-ab12cd34', name: 'Sana 😀', note: EMOJI, reason: 'Valve leaking 😀' })).toMatchObject({ success: true });
  });

  it('REV23 robustness-jobs-02 cleaned free text keeps a U+FFFD in its place', () => {
    expect(toWellFormedText(LONE_LEAD)).toBe('Driver forgot � the label');
    expect(toWellFormedText('\ude00😀\ud83d')).toBe('�😀�');
    expect(toWellFormedText(EMOJI)).toBe(EMOJI);
    expect(cleanCustomerComment(`  ${LONE_LEAD}\n`)).toBe('Driver forgot � the label');
    expect(cleanDaySheetReason(LONE_TRAIL)).toBe('Driver forgot � the label');
    expect(cleanDaySheetReason(EMOJI)).toBe(EMOJI);
  });

  it("REV23 robustness-jobs-02 the query engine's refusal that still happens is a 400 at warn level, not a 500", () => {
    const engine = (message: string) =>
      new Prisma.PrismaClientKnownRequestError(`\nInvalid \`prisma.cylinder.findUnique()\` invocation:\n\n\n${message}`, { code: 'InvalidArg', clientVersion: '5.22.0' });
    const outcome = (error: unknown) => {
      const mapped = toApiError(error);
      return { status: mapped.status, code: mapped.code, log: mapped.log };
    };
    const badRequest = { status: 400, code: 'VALIDATION_FAILED', log: 'warn' };
    expect(outcome(engine('lone leading surrogate in hex escape at line 1 column 89'))).toEqual(badRequest);
    expect(outcome(engine('unexpected end of hex escape at line 1 column 98'))).toEqual(badRequest);
    expect(
      outcome(new Prisma.PrismaClientValidationError('Invalid value for argument `parameters`: unexpected end of hex escape at line 1 column 10. Expected JSON String.', { clientVersion: '5.22.0' })),
    ).toEqual(badRequest);
    // Anything else of these kinds stays a server fault.
    expect(outcome(engine('something else went wrong')).status).toBe(500);
  });
});
