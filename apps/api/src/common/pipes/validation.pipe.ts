import { ValidationPipe, type ValidationError } from '@nestjs/common';
import type { FieldError } from '@smartfleet/shared-types';
import type { ValidationCode } from '@smartfleet/shared-validation';
import { AppError } from '../errors/app-error';
import { validationMessage } from '../errors/messages';

/** class-validator constraint names → validation codes; the bound comes from the constraint's text. */
const CONSTRAINT_CODES: Readonly<Record<string, { code: ValidationCode; bound?: 'min' | 'max' }>> = {
  isDefined: { code: 'REQUIRED' },
  isNotEmpty: { code: 'REQUIRED' },
  whitelistValidation: { code: 'NOT_ALLOWED' },
  isString: { code: 'INVALID_TYPE' },
  isNumber: { code: 'INVALID_TYPE' },
  isBoolean: { code: 'INVALID_TYPE' },
  isObject: { code: 'INVALID_TYPE' },
  isArray: { code: 'INVALID_TYPE' },
  isDate: { code: 'INVALID_DATE' },
  isInt: { code: 'NOT_INTEGER' },
  min: { code: 'TOO_SMALL', bound: 'min' },
  max: { code: 'TOO_LARGE', bound: 'max' },
  minLength: { code: 'TOO_SHORT', bound: 'min' },
  maxLength: { code: 'TOO_LONG', bound: 'max' },
  arrayMinSize: { code: 'TOO_FEW_ITEMS', bound: 'min' },
  arrayMaxSize: { code: 'TOO_MANY_ITEMS', bound: 'max' },
  arrayNotEmpty: { code: 'REQUIRED' },
  isEnum: { code: 'INVALID_CHOICE' },
  isIn: { code: 'INVALID_CHOICE' },
  isUuid: { code: 'INVALID_ID' },
  isEmail: { code: 'INVALID_EMAIL' },
  isDateString: { code: 'INVALID_DATETIME' },
  isIso8601: { code: 'INVALID_DATETIME' },
  matches: { code: 'INVALID_FORMAT' },
  isPhoneNumber: { code: 'INVALID_FORMAT' },
  isMobilePhone: { code: 'INVALID_FORMAT' },
};

/** The number in class-validator's default text: "must be shorter than or equal to 40 characters". */
function boundFromText(text: string): number | undefined {
  const match = /(?:equal to|less than|greater than|at least|no more than)\s+(-?\d+(?:\.\d+)?)/.exec(text);
  return match ? Number(match[1]) : undefined;
}

function fieldError(path: string, constraint: string, text: string): FieldError {
  const known = CONSTRAINT_CODES[constraint];
  if (!known) return { path, code: 'INVALID_VALUE', message: validationMessage('INVALID_VALUE') };
  if (!known.bound) return { path, code: known.code, message: validationMessage(known.code) };
  const bound = boundFromText(text);
  if (bound === undefined) return { path, code: 'INVALID_VALUE', message: validationMessage('INVALID_VALUE') };
  const params = { [known.bound]: bound };
  return { path, code: known.code, message: validationMessage(known.code, params), params };
}

/** class-validator errors → `details.fields`, one entry per property, nested paths dotted. */
export function fieldErrorsFromClassValidator(errors: readonly ValidationError[], prefix = ''): FieldError[] {
  const fields: FieldError[] = [];
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const entries = Object.entries(error.constraints ?? {});
    if (entries.length > 0) {
      const [constraint, text] = entries[0];
      fields.push(fieldError(path, constraint, text));
    }
    if (error.children && error.children.length > 0) {
      fields.push(...fieldErrorsFromClassValidator(error.children, path));
    }
  }
  return fields;
}

/**
 * The global pipe for the remaining class-validator DTOs (main.ts:23-29 options, unchanged), with its
 * failures in the shared format: 400 VALIDATION_FAILED and `details.fields: [{ path, code, message }]`
 * (API_CONTRACT §2.2). Parameters typed with zod schemas (`ZodBody`) are not classes, so it skips them.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new AppError('VALIDATION_FAILED', { fields: fieldErrorsFromClassValidator(errors) }),
  });
}
