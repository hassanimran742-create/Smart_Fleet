import { z } from 'zod';
import { isValidationCode, PROMOTED_ERROR_CODES, type PromotedErrorCode, type ValidationCode } from './messages';

/** One field problem: a dotted path, a validation code and the template parameters for its message. */
export interface FieldIssue {
  /** For example "lines.0.fullCount"; "" for the body itself. */
  path: string;
  code: ValidationCode;
  /** For example `{ min: 3 }` or `{ maxPaisa: "10000000" }`. */
  params?: Record<string, string | number>;
}

function codeForIssue(issue: z.ZodIssueOptionalMessage, data: unknown): ValidationCode {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.expected === 'never') return 'NOT_ALLOWED';
      if (issue.received === 'undefined' || issue.received === 'null') return 'REQUIRED';
      if (issue.expected === 'integer') return 'NOT_INTEGER';
      return 'INVALID_TYPE';
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return Number(issue.minimum) <= 1 ? 'REQUIRED' : 'TOO_SHORT';
      if (issue.type === 'array' || issue.type === 'set') return 'TOO_FEW_ITEMS';
      if (issue.type === 'date') return 'INVALID_DATE';
      return 'TOO_SMALL';
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return 'TOO_LONG';
      if (issue.type === 'array' || issue.type === 'set') return 'TOO_MANY_ITEMS';
      if (issue.type === 'date') return 'INVALID_DATE';
      return 'TOO_LARGE';
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'uuid' || issue.validation === 'cuid' || issue.validation === 'cuid2') return 'INVALID_ID';
      if (issue.validation === 'email') return 'INVALID_EMAIL';
      if (issue.validation === 'datetime') return 'INVALID_DATETIME';
      if (issue.validation === 'date') return 'INVALID_DATE';
      return 'INVALID_FORMAT';
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union_discriminator:
      return 'INVALID_CHOICE';
    case z.ZodIssueCode.invalid_date:
      return 'INVALID_DATE';
    case z.ZodIssueCode.unrecognized_keys:
      return 'NOT_ALLOWED';
    case z.ZodIssueCode.invalid_union:
      return data === undefined || data === null ? 'REQUIRED' : 'INVALID_VALUE';
    default:
      return 'INVALID_VALUE';
  }
}

/**
 * A zod error map that names every issue with a {@link ValidationCode}. Pass it when parsing
 * (`schema.safeParse(body, { errorMap: validationErrorMap })`, or use {@link parseRequest}), so no zod
 * English reaches a screen. Codes set by the schemas themselves (check messages, `z.enum(..., { message })`)
 * take precedence: zod applies this map last, so it keeps a message that is already a code.
 */
export const validationErrorMap: z.ZodErrorMap = (issue, ctx) => ({
  message: isValidationCode(ctx.defaultError) ? ctx.defaultError : codeForIssue(issue, ctx.data),
});

/** Codes whose English shows `{{min}}` or `{{max}}` taken from zod's bound. */
const MIN_CODES: readonly ValidationCode[] = ['TOO_SHORT', 'TOO_SMALL', 'TOO_FEW_ITEMS'];
const MAX_CODES: readonly ValidationCode[] = ['TOO_LONG', 'TOO_LARGE', 'TOO_MANY_ITEMS'];

function paramsForIssue(issue: z.ZodIssue, code: ValidationCode): Record<string, string | number> | undefined {
  if (issue.code === z.ZodIssueCode.too_small) return MIN_CODES.includes(code) ? { min: Number(issue.minimum) } : undefined;
  if (issue.code === z.ZodIssueCode.too_big) return MAX_CODES.includes(code) ? { max: Number(issue.maximum) } : undefined;
  if (issue.code === z.ZodIssueCode.custom && issue.params) {
    const params: Record<string, string | number> = {};
    for (const key of Object.keys(issue.params)) {
      const value: unknown = issue.params[key];
      if (typeof value === 'string' || typeof value === 'number') params[key] = value;
    }
    return Object.keys(params).length > 0 ? params : undefined;
  }
  return undefined;
}

/** Converts a zod error into field issues with stable codes, whether or not the error map was used. */
export function toFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => {
    const code = isValidationCode(issue.message) ? issue.message : codeForIssue(issue, undefined);
    const params = paramsForIssue(issue, code);
    return params ? { path: issue.path.join('.'), code, params } : { path: issue.path.join('.'), code };
  });
}

/**
 * The error code for a failed body: the shared code when every issue is the same promoted code (for
 * example `AMOUNT_NOT_WHOLE_RUPEES`), otherwise `VALIDATION_FAILED`.
 */
export function primaryErrorCode(issues: readonly FieldIssue[]): PromotedErrorCode | 'VALIDATION_FAILED' {
  const first = issues[0]?.code;
  const promoted = (PROMOTED_ERROR_CODES as readonly string[]).includes(first ?? '');
  return promoted && issues.every((issue) => issue.code === first) ? (first as PromotedErrorCode) : 'VALIDATION_FAILED';
}

export type ParseRequestResult<T> =
  | { success: true; data: T }
  | { success: false; errorCode: PromotedErrorCode | 'VALIDATION_FAILED'; fields: FieldIssue[] };

/** Parses a request body or a form with the validation codes applied: the one entry point for the API pipe and forms. */
export function parseRequest<S extends z.ZodTypeAny>(schema: S, input: unknown): ParseRequestResult<z.output<S>> {
  const result = schema.safeParse(input, { errorMap: validationErrorMap });
  if (result.success) return { success: true, data: result.data };
  const fields = toFieldIssues(result.error);
  return { success: false, errorCode: primaryErrorCode(fields), fields };
}
