import * as fs from 'fs';
import * as path from 'path';
import {
  APP_ERROR_MESSAGE_EN,
  CLIENT_ERROR_CODES,
  CLIENT_ERROR_MESSAGE_EN,
  ERROR_CODES,
  ERROR_DETAIL_KEYS,
  ERROR_HTTP,
  ERROR_MESSAGE_EN,
  type ErrorCode,
} from '@smartfleet/shared-types';
import { AppError } from '../../src/common/errors/app-error';
import { errorMessage, hasUnfilledParams } from '../../src/common/errors/messages';

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function paramsOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

/** The documented details keys of a code, with the `Paisa` suffix dropped (API_CONTRACT §2.1). */
function documentedParams(code: ErrorCode): Set<string> {
  const keys = ERROR_DETAIL_KEYS[code] ?? [];
  return new Set(keys.map((key) => (key.endsWith('Paisa') && key.length > 5 ? key.slice(0, -5) : key)));
}

/** Sample details for a code: a value for every documented key (paisa as digit strings). */
function sampleDetails(code: ErrorCode): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const key of ERROR_DETAIL_KEYS[code] ?? []) {
    details[key] = key.endsWith('Paisa') ? '33000' : key === 'fields' || key === 'rows' || key === 'missing' ? [] : 'x';
  }
  return details;
}

describe('ErrorCode catalogue (API_CONTRACT §2.3)', () => {
  it('has unique codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES.length).toBeGreaterThan(100);
  });

  it.each(ERROR_CODES.map((code) => [code]))('%s has an HTTP status and an English message', (code) => {
    const status = ERROR_HTTP[code];
    expect(Number.isInteger(status)).toBe(true);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
    const message = ERROR_MESSAGE_EN[code];
    expect(typeof message).toBe('string');
    expect(message.trim().length).toBeGreaterThan(0);
    expect(message).toMatch(/[.!?]$/);
  });

  it('maps every {{param}} to a documented details key once the Paisa suffix is dropped', () => {
    const undocumented: string[] = [];
    for (const code of ERROR_CODES) {
      const documented = documentedParams(code);
      for (const param of paramsOf(ERROR_MESSAGE_EN[code])) {
        if (!documented.has(param)) undocumented.push(`${code}: {{${param}}}`);
      }
    }
    expect(undocumented).toEqual([]);
  });

  it('documents details keys only for catalogue codes', () => {
    for (const code of Object.keys(ERROR_DETAIL_KEYS)) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('renders every code as plain English with its documented details', () => {
    for (const code of ERROR_CODES) {
      const message = errorMessage(code, sampleDetails(code));
      expect(hasUnfilledParams(message)).toBe(false);
    }
  });

  it('formats a *Paisa detail with formatRs and drops the suffix', () => {
    expect(
      errorMessage('WALLET_INSUFFICIENT_BALANCE', { requiredPaisa: '33000', balancePaisa: '12000', shortByPaisa: '21000' }),
    ).toBe('Not enough balance. This needs Rs 330 and you have Rs 120. Add money to continue.');
  });

  it('falls back to a parameter-free sentence of the same status when details are missing', () => {
    const message = errorMessage('TOPUP_BANK_REFERENCE_USED', {});
    expect(hasUnfilledParams(message)).toBe(false);
    expect(message).toBe(ERROR_MESSAGE_EN.CONFLICT_STALE_STATE);
  });

  it('gives AppError the catalogue status for every code', () => {
    for (const code of ERROR_CODES) {
      const error = new AppError(code as 'NOT_FOUND', sampleDetails(code) as never);
      expect(error.getStatus()).toBe(ERROR_HTTP[code]);
      expect(error.code).toBe(code);
    }
  });

  it('never words a sign-in error with "OTP" or "one-time code" (installed PhoneScreen jumps to OTP on them)', () => {
    for (const code of ERROR_CODES.filter((c) => c.startsWith('AUTH_'))) {
      expect(ERROR_MESSAGE_EN[code].toLowerCase()).not.toMatch(/otp|one-time code/);
    }
  });

  it('gives the apps English for the client-only codes too', () => {
    for (const code of CLIENT_ERROR_CODES) {
      expect(APP_ERROR_MESSAGE_EN[code].length).toBeGreaterThan(0);
    }
  });
});

// ---- FND-008: the catalogue against the API_CONTRACT §2.3 tables and both apps' resources ----

const CONTRACT_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'pilot', 'API_CONTRACT.md');

/** The §2.3 tables: `| CODE [Inc n] | HTTP | English |` rows and the `| Code | details |` table. */
function readContractCatalogue(): {
  rows: Map<string, { status: number; english: string }>;
  details: Map<string, string[]>;
} {
  const lines = fs.readFileSync(CONTRACT_PATH, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('### 2.3 Catalogue'));
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## 3.'));
  const section = lines.slice(start, end);
  const rows = new Map<string, { status: number; english: string }>();
  for (const line of section) {
    const match = /^\| ([A-Z][A-Z0-9_]+)(?: \[Inc \d\])? \| (\d{3}) \| (.*) \|$/.exec(line);
    if (match) rows.set(match[1], { status: Number(match[2]), english: match[3] });
  }
  const details = new Map<string, string[]>();
  const head = section.findIndex((line) => line.startsWith('| Code | `details` |'));
  for (let i = head + 2; i < section.length && section[i].startsWith('|'); i++) {
    const match = /^\| ([^|]+) \| (.*) \|$/.exec(section[i]);
    if (!match) continue;
    // Keys are the backticked names before any parenthesis or `;` remark.
    const cell = match[2].replace(/\([^)]*\)/g, '').split(';')[0];
    const keys = [...cell.matchAll(/`([A-Za-z]+)\??[^`]*`/g)].map((m) => m[1]);
    for (const code of match[1].split(',').map((c) => c.trim())) details.set(code, keys);
  }
  return { rows, details };
}

describe('FND-008 The error catalogue is complete: a status, English text, documented parameters and an app key for every code', () => {
  const { rows, details } = readContractCatalogue();

  it('FND-008 every code has a 400–599 status and English, and the codes are exactly the §2.3 tables', () => {
    expect(rows.size).toBeGreaterThan(100);
    expect([...ERROR_CODES].sort()).toEqual([...rows.keys()].sort());
    expect(Object.keys(ERROR_HTTP).sort()).toEqual([...ERROR_CODES].sort());
    expect(Object.keys(ERROR_MESSAGE_EN).sort()).toEqual([...ERROR_CODES].sort());
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_HTTP[code]).toBeLessThan(600);
      expect(ERROR_MESSAGE_EN[code].length).toBeGreaterThan(0);
    }
  });

  it('FND-008 statuses and English match §2.3 word for word', () => {
    const mismatches: string[] = [];
    for (const [code, row] of rows) {
      const c = code as ErrorCode;
      if (ERROR_HTTP[c] !== row.status) mismatches.push(`${code}: status ${ERROR_HTTP[c]} vs ${row.status}`);
      if (ERROR_MESSAGE_EN[c] !== row.english) mismatches.push(`${code}: "${ERROR_MESSAGE_EN[c]}" vs "${row.english}"`);
    }
    expect(mismatches).toEqual([]);
    expect(ERROR_HTTP.FEATURE_DISABLED).toBe(403);
    expect(ERROR_HTTP.APP_UPDATE_REQUIRED).toBe(426);
    expect(ERROR_HTTP.PAYMENT_WEBHOOK_DISABLED).toBe(410);
    expect(ERROR_HTTP.FILE_TYPE_NOT_ALLOWED).toBe(415);
    expect(ERROR_HTTP.FILE_TOO_LARGE).toBe(413);
    expect(ERROR_HTTP.STORE_OUTSIDE_ZONES).toBe(422);
    expect(ERROR_HTTP.TOPUP_ACCOUNT_NOT_CONFIGURED).toBe(503);
    expect(ERROR_HTTP.RATE_LIMITED).toBe(429);
    expect(ERROR_HTTP.CONFIRM_LINK_INACTIVE).toBe(410);
    expect([ERROR_HTTP.DAY_SHEET_NOT_UPLOADED, ERROR_MESSAGE_EN.DAY_SHEET_NOT_UPLOADED]).toEqual([409, 'Upload the filled sheet first.']);
    expect(ERROR_HTTP.DAY_SHEET_OUTDATED).toBe(422);
  });

  it('FND-008 every {{param}} has a documented details key, and ERROR_DETAIL_KEYS matches the §2.3 details table', () => {
    expect(
      errorMessage('WALLET_INSUFFICIENT_BALANCE', { requiredPaisa: '48000', balancePaisa: '47900', shortByPaisa: '100' }),
    ).toBe('Not enough balance. This needs Rs 480 and you have Rs 479. Add money to continue.');
    expect(documentedParams('AUTH_WRONG_APP').has('app')).toBe(true);
    expect(documentedParams('FILE_TOO_LARGE').has('maxMb')).toBe(true);
    const mismatches: string[] = [];
    // Scan refusals also carry `progress` (§2.3: "scan refusals carry progress (§9.3)").
    const withoutProgress = (keys: readonly string[]) => keys.filter((key) => key !== 'progress');
    for (const [code, keys] of details) {
      const built = withoutProgress(ERROR_DETAIL_KEYS[code as ErrorCode] ?? []);
      if (JSON.stringify([...built].sort()) !== JSON.stringify([...keys].sort())) {
        mismatches.push(`${code}: [${built.join(', ')}] vs [${keys.join(', ')}]`);
      }
    }
    for (const code of Object.keys(ERROR_DETAIL_KEYS) as ErrorCode[]) {
      const own = ERROR_DETAIL_KEYS[code] ?? [];
      const extra = withoutProgress(own);
      if (!details.has(code) && extra.length > 0) mismatches.push(`${code}: [${extra.join(', ')}] not in §2.3`);
      if (own.includes('progress') && !/^(SCAN|REFILL)_/.test(code)) mismatches.push(`${code}: progress outside the scan codes`);
    }
    expect(mismatches).toEqual([]);
  });

  it('FND-008 the mobile resource is the catalogue plus the client codes and the website namespace has every code plus UNKNOWN; both import the texts', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const mobile = require('../../../mobile/src/i18n/en/errors').errors as Record<string, string>;
    const admin = require('../../../admin-web/src/i18n/en/errors').errors as Record<string, string>;
    /* eslint-enable @typescript-eslint/no-var-requires */
    expect(mobile).toEqual({ ...ERROR_MESSAGE_EN, ...CLIENT_ERROR_MESSAGE_EN });
    expect(admin).toEqual(expect.objectContaining({ ...ERROR_MESSAGE_EN, UNKNOWN: CLIENT_ERROR_MESSAGE_EN.UNKNOWN }));
    expect(CLIENT_ERROR_MESSAGE_EN).toEqual({
      NETWORK_OFFLINE: 'No connection. Try again.',
      NETWORK_TIMEOUT: 'This is taking too long. Check your signal and try again.',
      UNKNOWN: 'Something went wrong. Please try again.',
    });
    for (const file of ['../../../mobile/src/i18n/en/errors.ts', '../../../admin-web/src/i18n/en/errors.ts']) {
      const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
      expect(source).toMatch(/from '@smartfleet\/shared-types'/);
      expect(source).not.toMatch(/Please try again\.|Call the office/);
    }
  });

  it('FND-008 no AUTH_* message says "OTP" or "one-time code", in any letter case', () => {
    for (const code of ERROR_CODES.filter((c) => c.startsWith('AUTH_'))) {
      expect({ code, otpWording: /otp|one-time code/i.test(ERROR_MESSAGE_EN[code]) }).toEqual({ code, otpWording: false });
    }
  });
});
