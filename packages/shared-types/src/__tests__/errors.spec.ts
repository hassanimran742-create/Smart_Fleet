import {
  APP_ERROR_MESSAGE_EN,
  CLIENT_ERROR_CODES,
  CLIENT_ERROR_MESSAGE_EN,
  ERROR_CODES,
  ERROR_DETAIL_KEYS,
  ERROR_HTTP,
  ERROR_MESSAGE_EN,
  isErrorCode,
} from '../errors';

const HTTP_STATUSES = [400, 401, 403, 404, 409, 410, 413, 415, 422, 426, 429, 500, 503];

function templateParams(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
}

/**
 * Fixed words a person reads (UX_PRINCIPLES §6): data is never counted, so `{{param}}` values and
 * tokens with digits ("300 1234567") are left out.
 */
function fixedWords(text: string): number {
  return text
    .replace(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter((token) => token.length > 0 && !/\d/.test(token)).length;
}

/**
 * Over the 12-word budget on purpose, with the reason. PRICING_PRICE_NOT_SET is shown by neither app
 * as it is: the shop app words the pricing block with its own `customers.block.*` keys.
 */
const OVER_BUDGET: Partial<Record<string, string>> = {
  PRICING_PRICE_NOT_SET: 'the shop app shows customers.block.* instead',
};

describe('error catalogue (API_CONTRACT §2.3)', () => {
  it('has unique UPPER_SNAKE codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/);
    expect(ERROR_CODES.length).toBe(142);
  });

  it('gives every code an HTTP status and English text', () => {
    expect(Object.keys(ERROR_HTTP).sort()).toEqual([...ERROR_CODES].sort());
    expect(Object.keys(ERROR_MESSAGE_EN).sort()).toEqual([...ERROR_CODES].sort());
    for (const code of ERROR_CODES) {
      expect({ code, status: HTTP_STATUSES.includes(ERROR_HTTP[code]) }).toEqual({ code, status: true });
      const message = ERROR_MESSAGE_EN[code];
      expect(message.trim()).toBe(message);
      expect(message).toMatch(/[.!?]$/);
      expect(message).not.toMatch(/\n/);
    }
  });

  it('maps every {{param}} to a documented details key once Paisa is dropped', () => {
    for (const code of ERROR_CODES) {
      const documented = new Set((ERROR_DETAIL_KEYS[code] ?? []).map((key) => key.replace(/Paisa$/, '')));
      const undocumented = templateParams(ERROR_MESSAGE_EN[code]).filter((param) => !documented.has(param));
      expect({ code, undocumented }).toEqual({ code, undocumented: [] });
    }
  });

  it('documents details only for catalogue codes', () => {
    for (const code of Object.keys(ERROR_DETAIL_KEYS)) expect(isErrorCode(code)).toBe(true);
  });

  it('keeps sign-in errors free of OTP wording (PhoneScreen.tsx jumps to OTP on it)', () => {
    for (const code of ERROR_CODES.filter((c) => c.startsWith('AUTH_'))) {
      expect(ERROR_MESSAGE_EN[code]).not.toMatch(/otp|one-time code/i);
    }
  });

  it('keeps the statuses the contract names', () => {
    expect(ERROR_HTTP.VALIDATION_FAILED).toBe(400);
    expect(ERROR_HTTP.WALLET_INSUFFICIENT_BALANCE).toBe(409);
    expect(ERROR_HTTP.PRICING_PRICE_NOT_SET).toBe(422);
    expect(ERROR_HTTP.APP_UPDATE_REQUIRED).toBe(426);
    expect(ERROR_HTTP.PAYMENT_WEBHOOK_DISABLED).toBe(410);
    expect(ERROR_HTTP.TOPUP_ACCOUNT_NOT_CONFIGURED).toBe(503);
    expect(ERROR_MESSAGE_EN.WALLET_INSUFFICIENT_BALANCE).toBe(
      'Not enough balance. This needs {{required}} and you have {{balance}}. Add money to continue.',
    );
  });

  it('recognises codes', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('NETWORK_OFFLINE')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});

describe('error texts follow the rulebook (UX_PRINCIPLES §5.3, §6)', () => {
  it('counts fixed words the way the rulebook does', () => {
    expect(fixedWords('Enter a number like 300 1234567.')).toBe(4);
    expect(fixedWords('Already used for {{paymentShortCode}} ({{distributorName}}). Check it, or reject as a duplicate.')).toBe(10);
    expect(fixedWords("Not loaded on your van. Don't deliver it. Call office.")).toBe(10);
  });

  it('keeps every error within 12 fixed words', () => {
    const texts: [string, string][] = [
      ...ERROR_CODES.map((code): [string, string] => [code, ERROR_MESSAGE_EN[code]]),
      ...CLIENT_ERROR_CODES.map((code): [string, string] => [code, CLIENT_ERROR_MESSAGE_EN[code]]),
    ];
    const over = texts
      .filter(([code, text]) => fixedWords(text) > 12 && !OVER_BUDGET[code])
      .map(([code, text]) => `${code} (${fixedWords(text)}): ${text}`);
    expect(over).toEqual([]);
    for (const code of Object.keys(OVER_BUDGET)) expect(isErrorCode(code)).toBe(true);
  });

  it('never says "pilot", "case" or "No internet"', () => {
    for (const text of Object.values(APP_ERROR_MESSAGE_EN)) {
      expect({ text, banned: /\bpilot\b|\bcases?\b|no internet/i.test(text) }).toEqual({ text, banned: false });
    }
  });

  it('has the shorter texts of the UX pass of 2026-10-23', () => {
    expect(APP_ERROR_MESSAGE_EN).toMatchObject({
      FEATURE_DISABLED: "This isn't available yet.",
      CLIENT_PHONE_INVALID: 'Enter a number like 300 1234567.',
      ORDER_CANCEL_TERMS_CHANGED: 'Delivery has just started. The refund is now {{refund}}.',
      DELIVERY_SCANS_INCOMPLETE: 'Scan every cylinder before you finish the visit.',
      TRIP_VAN_NOT_EMPTY: 'The store must scan in {{count}} more from your van.',
      SCAN_CYLINDER_UNKNOWN: "We don't know this cylinder. Check the label.",
      SCAN_STOP_CLOSED: 'This step is already done.',
      SCAN_CYLINDER_BLOCKED: 'Marked damaged or lost. Put it aside. Call office.',
      SCAN_NOT_ON_YOUR_VAN: "Not loaded on your van. Don't deliver it. Call office.",
      SCAN_TAKEN_BACK_NOT_UNLOADED: 'Taken back from a customer. Unload it at the store first.',
      SCAN_GIVEN_THIS_VISIT: "You just delivered this one. You can't take it back now.",
      CASE_ALREADY_RESOLVED: 'This problem was already sorted by {{by}}.',
      TOPUP_BANK_REFERENCE_USED: 'Already used for {{paymentShortCode}} ({{distributorName}}). Check it, or reject as a duplicate.',
      TOPUP_AMOUNT_MISMATCH: 'Amounts must match. Reject and ask for a new request.',
      // Reads right for 1 and for many (API_CONTRACT §2.3, G16-04): "All picked up: 1 of 1."
      REFILL_COUNT_REACHED: 'All picked up: {{requested}} of {{requested}}.',
      DAY_SHEET_OUTDATED: 'This is an old copy. Download a new sheet and use that.',
      NETWORK_OFFLINE: 'No connection. Try again.',
    });
  });
});

describe('client-only codes', () => {
  it('have English text and merge into the apps resource', () => {
    expect(Object.keys(CLIENT_ERROR_MESSAGE_EN).sort()).toEqual([...CLIENT_ERROR_CODES].sort());
    expect(Object.keys(APP_ERROR_MESSAGE_EN)).toHaveLength(ERROR_CODES.length + CLIENT_ERROR_CODES.length);
    expect(APP_ERROR_MESSAGE_EN.NETWORK_OFFLINE).toBe('No connection. Try again.');
    expect(APP_ERROR_MESSAGE_EN.NOT_FOUND).toBe(ERROR_MESSAGE_EN.NOT_FOUND);
    for (const code of CLIENT_ERROR_CODES) expect(isErrorCode(code)).toBe(false);
  });
});
