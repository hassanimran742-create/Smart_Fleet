import { formatRs, type PaisaLike } from './money';
import { formatIsoDay, isIsoDate } from './time';

/** Values an i18next template can show. */
export type MessageParams = Record<string, string | number | boolean>;

const PAISA_SUFFIX = 'Paisa';
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function isPaisaLike(value: unknown): value is PaisaLike {
  return (
    typeof value === 'bigint' ||
    (typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' && /^-?\d+$/.test(value))
  );
}

/** A details key holding a calendar date: `date` itself, or a name ending in `Date` (`sheetDate`). */
function isDateKey(key: string): boolean {
  return key === 'date' || (key.length > 4 && key.endsWith('Date'));
}

/**
 * Turns an error's `details` into template parameters (API_CONTRACT §2.1):
 * - a key ending in `Paisa` is formatted with {@link formatRs} and loses its suffix
 *   (`requiredPaisa: "33000"` adds `required: "Rs 330"`);
 * - a key named `date` or ending in `Date` whose value is a `YYYY-MM-DD` date is shown with
 *   {@link formatIsoDay} under the same name (`sheetDate: "2026-10-20"` becomes "Tue 20 Oct");
 * - other strings, numbers and booleans are kept as they are; objects and arrays are left out because
 *   templates never show them.
 */
export function toMessageParams(details?: Record<string, unknown> | null): MessageParams {
  const params: MessageParams = {};
  if (!details) return params;
  for (const key of Object.keys(details)) {
    const value = details[key];
    if (typeof value === 'string' && isDateKey(key) && isIsoDate(value)) params[key] = formatIsoDay(value);
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') params[key] = value;
  }
  for (const key of Object.keys(details)) {
    const value = details[key];
    if (key.length > PAISA_SUFFIX.length && key.endsWith(PAISA_SUFFIX) && isPaisaLike(value)) {
      params[key.slice(0, -PAISA_SUFFIX.length)] = formatRs(value);
    }
  }
  return params;
}

/**
 * Fills `{{name}}` placeholders from `params`. A missing parameter leaves its placeholder in place,
 * as i18next does, so a gap is visible instead of silently empty.
 */
export function interpolate(template: string, params?: Record<string, unknown> | null): string {
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = params ? params[name] : undefined;
    return value === undefined || value === null ? placeholder : String(value);
  });
}

/**
 * Renders an English template with an error's `details`, by the same rules the apps use for
 * i18next: `renderMessage(ERROR_MESSAGE_EN[code], details)` is the API's `message`.
 */
export function renderMessage(template: string, details?: Record<string, unknown> | null): string {
  return interpolate(template, toMessageParams(details));
}
