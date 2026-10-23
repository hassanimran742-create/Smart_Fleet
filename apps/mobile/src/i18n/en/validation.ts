import { VALIDATION_MESSAGE_EN, type ValidationCode } from '@smartfleet/shared-validation';

/**
 * `validation.<CODE>` (foundation namespace): the English for the field codes inside a
 * `VALIDATION_FAILED` error's `details.fields[]`. Like `errors`, it is the shared catalogue
 * (`VALIDATION_MESSAGE_EN`), never reworded here. `fieldErrorsOf` in api/errors.ts reads it.
 */
export const validation: { readonly [C in ValidationCode]: string } = { ...VALIDATION_MESSAGE_EN };
