/**
 * Field-level validation codes. Every zod issue raised by these schemas carries one of them as its
 * `message`, never zod's English: the API returns it in `VALIDATION_FAILED` `details.fields[].code`
 * and the apps translate it (`validation.<CODE>`), with {@link VALIDATION_MESSAGE_EN} as the English.
 *
 * The last group are also catalogue error codes (shared-types `ERROR_CODES`). When every problem in a
 * body is the same one of those, the API answers with that code instead of `VALIDATION_FAILED`
 * (see `primaryErrorCode`), as API_CONTRACT §2.3 and §7 name them.
 */
export const VALIDATION_CODES = [
  'REQUIRED',
  'INVALID_TYPE',
  'INVALID_VALUE',
  'INVALID_CHOICE',
  'INVALID_ID',
  'INVALID_FORMAT',
  'INVALID_EMAIL',
  'INVALID_DATE',
  'INVALID_DATETIME',
  'INVALID_LOCATION',
  'INVALID_CNIC',
  'INVALID_PHONE',
  'TOO_SHORT',
  'TOO_LONG',
  'TOO_SMALL',
  'TOO_LARGE',
  'NOT_INTEGER',
  'TOO_FEW_ITEMS',
  'TOO_MANY_ITEMS',
  'DUPLICATE_ITEM',
  'NOT_ALLOWED',
  'NOTE_REQUIRED',
  'END_BEFORE_START',
  'INVALID_AMOUNT',
  'AMOUNT_TOO_SMALL',
  'AMOUNT_TOO_LARGE',
  // Also catalogue error codes:
  'AMOUNT_NOT_WHOLE_RUPEES',
  'PRICE_INVALID',
  'DISTRIBUTOR_CODE_INVALID',
  'ORDER_LINES_INVALID',
  'SCAN_EVENT_NOT_ALLOWED',
  'TOPUP_BANK_REFERENCE_REQUIRED',
  'REFILL_INVALID_COUNT',
  'SCAN_RETURN_STATE_REQUIRED',
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

/**
 * Validation codes that are also catalogue error codes, so a body failing only on one of them gets that
 * code (API_CONTRACT §2.2). `SCAN_RETURN_STATE_REQUIRED` is used by the Inc 2 trip-scan body.
 */
export const PROMOTED_ERROR_CODES = [
  'AMOUNT_NOT_WHOLE_RUPEES',
  'PRICE_INVALID',
  'DISTRIBUTOR_CODE_INVALID',
  'ORDER_LINES_INVALID',
  'SCAN_EVENT_NOT_ALLOWED',
  'TOPUP_BANK_REFERENCE_REQUIRED',
  'REFILL_INVALID_COUNT',
  'SCAN_RETURN_STATE_REQUIRED',
] as const satisfies readonly ValidationCode[];
export type PromotedErrorCode = (typeof PROMOTED_ERROR_CODES)[number];

/**
 * English for each validation code: i18next templates. `{{min}}` and `{{max}}` come from the issue's
 * `params`; a `minPaisa`/`maxPaisa` param is formatted with `formatRs` and loses its suffix, as for
 * error details. The promoted codes repeat their `ERROR_MESSAGE_EN` text exactly.
 */
export const VALIDATION_MESSAGE_EN: { readonly [C in ValidationCode]: string } = {
  REQUIRED: 'Fill this in.',
  INVALID_TYPE: 'Check this value.',
  INVALID_VALUE: 'Check this value.',
  INVALID_CHOICE: 'Pick one of the options.',
  INVALID_ID: 'Pick one from the list.',
  INVALID_FORMAT: "This isn't in the right format.",
  INVALID_EMAIL: 'Enter an email address like name@example.com.',
  INVALID_DATE: 'Enter a real date.',
  INVALID_DATETIME: 'Enter a real date and time.',
  INVALID_LOCATION: 'Pick one spot on the map.',
  INVALID_CNIC: 'Enter the 13-digit CNIC, like 35202-1234567-1.',
  INVALID_PHONE: 'Enter a mobile number like 0300 1234567.',
  TOO_SHORT: 'Use at least {{min}} characters.',
  TOO_LONG: 'Use at most {{max}} characters.',
  TOO_SMALL: 'Enter {{min}} or more.',
  TOO_LARGE: 'Enter {{max}} or less.',
  NOT_INTEGER: 'Enter a whole number.',
  TOO_FEW_ITEMS: 'Add at least {{min}}.',
  TOO_MANY_ITEMS: 'You can add at most {{max}}.',
  DUPLICATE_ITEM: 'This is listed twice.',
  NOT_ALLOWED: "This can't be sent here.",
  NOTE_REQUIRED: 'Write a short note, at least {{min}} characters.',
  END_BEFORE_START: 'The end must be after the start.',
  INVALID_AMOUNT: 'Enter an amount in rupees.',
  AMOUNT_TOO_SMALL: 'Enter at least {{min}}.',
  AMOUNT_TOO_LARGE: 'Enter at most {{max}}.',
  AMOUNT_NOT_WHOLE_RUPEES: 'Enter whole rupees, with no paisa.',
  PRICE_INVALID: 'Enter whole rupees, from Rs 0 to Rs 100,000.',
  DISTRIBUTOR_CODE_INVALID: 'Use 2 to 6 capital letters or digits, starting with a letter.',
  ORDER_LINES_INVALID: 'Add at least one full cylinder, one line per size.',
  SCAN_EVENT_NOT_ALLOWED: "This scan isn't allowed.",
  TOPUP_BANK_REFERENCE_REQUIRED: 'Type the bank reference from the company bank app.',
  REFILL_INVALID_COUNT: 'Check the number of cylinders.',
  SCAN_RETURN_STATE_REQUIRED: 'Choose Empty, Part-filled or Full first.',
};

export function isValidationCode(value: unknown): value is ValidationCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VALIDATION_MESSAGE_EN, value);
}
