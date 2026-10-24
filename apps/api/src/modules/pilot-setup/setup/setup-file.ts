import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import {
  PROMOTED_ERROR_CODES,
  pilotSetupFileSchema,
  toFieldIssues,
  validationErrorMap,
  type PilotSetupFile,
} from '@smartfleet/shared-validation';
import { PilotRefusal, type JsonPath } from '../refusal';

/**
 * Reading and checking the setup file without the database (API_CONTRACT §10.3): the JSON, the shared
 * `pilotSetupFileSchema` (shapes, strict keys, unique natural keys, references inside the file), then the
 * rules that need the whole file: normalised phones are unique across the logins and per shop's
 * customers, one cylinder type per size, and opening balances only with `--test`.
 */

/** The file's sections in the order the run checks and writes them; a refusal names the first bad one. */
export const SETUP_SECTIONS = [
  'description',
  'city',
  'zones',
  'officeUsers',
  'distributors',
  'cylinderTypes',
  'prices',
  'drivers',
  'stations',
  'settings',
  'stock',
  'customers',
  'openingBalances',
] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

/** The repository root (six levels above apps/api/src/modules/pilot-setup/setup, or its dist twin), for `pilot/<name>.json`. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');

/**
 * Where `--file` points: as given (absolute, or against the current directory), else against the
 * repository root, so `--file pilot/test.json` works from `apps/api` (where `npm run` runs) and from the
 * root alike. Null when neither exists.
 */
export function resolveSetupFilePath(given: string, cwd: string = process.cwd()): string | null {
  const direct = path.resolve(cwd, given);
  if (existsSync(direct)) return direct;
  if (!path.isAbsolute(given)) {
    const fromRoot = path.resolve(REPO_ROOT, given);
    if (existsSync(fromRoot)) return fromRoot;
  }
  return null;
}

/** The file's text as JSON, or a one-line reason it can't be read. */
export function readSetupJson(filePath: string): { ok: true; json: unknown } | { ok: false; reason: string } {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    return { ok: false, reason: `Can't read ${filePath}: ${(error as Error).message}` };
  }
  try {
    return { ok: true, json: JSON.parse(text.replace(/^﻿/, '')) };
  } catch (error) {
    return { ok: false, reason: `${filePath} isn't valid JSON: ${(error as Error).message}` };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A short name for the entry at `entryPath` (`['zones', 2]` → "East"), read from the raw file. */
export function entryLabel(raw: unknown, entryPath: JsonPath): string | undefined {
  const [section, index] = entryPath;
  const file = asRecord(raw);
  if (!file || typeof section !== 'string') return undefined;
  if (section === 'settings') return typeof index === 'string' ? index : undefined;
  if (section === 'city') return text(asRecord(file.city)?.name) ?? undefined;
  const list = file[section];
  if (!Array.isArray(list) || typeof index !== 'number') return undefined;
  const entry = asRecord(list[index]);
  if (!entry) return undefined;
  switch (section) {
    case 'distributors':
      return text(entry.businessName) ?? text(entry.code) ?? undefined;
    case 'cylinderTypes':
      return text(entry.code) ?? text(entry.name) ?? undefined;
    case 'prices':
      return text(entry.distributor) && text(entry.zone) ? `${text(entry.distributor)} in ${text(entry.zone)}` : undefined;
    case 'stock':
      return text(entry.distributor) && text(entry.cylinderType) ? `${text(entry.distributor)} ${text(entry.cylinderType)}` : undefined;
    case 'openingBalances':
      return text(entry.distributor) ?? undefined;
    default:
      return text(entry.name) ?? undefined;
  }
}

function sectionRank(issuePath: JsonPath): number {
  const rank = SETUP_SECTIONS.indexOf(issuePath[0] as SetupSection);
  return rank === -1 ? -1 : rank;
}

function firstIndex(issuePath: JsonPath): number {
  return typeof issuePath[1] === 'number' ? issuePath[1] : -1;
}

/**
 * Validates the file with the shared schema. The first problem, in section order then entry order, is the
 * refusal: a problem in a zone's `shape` is ZONE_INVALID_SHAPE; a field code that is also a catalogue code
 * (PRICE_INVALID, DISTRIBUTOR_CODE_INVALID, AMOUNT_NOT_WHOLE_RUPEES …) is that code; anything else is
 * VALIDATION_FAILED with the field's code and English.
 */
export function parseSetupFile(raw: unknown): { ok: true; file: PilotSetupFile } | { ok: false; refusal: PilotRefusal } {
  const result = pilotSetupFileSchema.safeParse(raw, { errorMap: validationErrorMap });
  if (result.success) return { ok: true, file: result.data };
  const fields = toFieldIssues(result.error);
  const issues = result.error.issues.map((issue, order) => ({ path: issue.path as JsonPath, field: fields[order], issue, order }));
  issues.sort((a, b) => sectionRank(a.path) - sectionRank(b.path) || firstIndex(a.path) - firstIndex(b.path) || a.order - b.order);
  const first = issues[0];
  const entryPath = first.path.slice(0, 2);
  const label = entryLabel(raw, entryPath);
  if (first.issue.code === 'unrecognized_keys') {
    const keys = first.issue.keys.map((key) => `"${key}"`).join(', ');
    return { ok: false, refusal: PilotRefusal.field(first.path, 'NOT_ALLOWED', { label, detail: `Unknown key ${keys}: check its spelling.` }) };
  }
  if (first.path[0] === 'zones' && typeof first.path[1] === 'number' && first.path[2] === 'shape') {
    return {
      ok: false,
      refusal: PilotRefusal.of(first.path.slice(0, 3), 'ZONE_INVALID_SHAPE', {
        label,
        detail: `The shape must be a GeoJSON Polygon or MultiPolygon with closed rings (${first.field.code} at ${pathText(first.path)}).`,
      }),
    };
  }
  if ((PROMOTED_ERROR_CODES as readonly string[]).includes(first.field.code)) {
    return { ok: false, refusal: PilotRefusal.of(first.path, first.field.code as (typeof PROMOTED_ERROR_CODES)[number], { label }) };
  }
  return { ok: false, refusal: PilotRefusal.field(first.path, first.field.code, { label, params: first.field.params }) };
}

function pathText(issuePath: JsonPath): string {
  return issuePath.map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`)).join('').replace(/^\./, '');
}

/** What the run knows about the file once it has passed every check that needs no database. */
export interface CheckedSetupFile {
  file: PilotSetupFile;
  /** E.164 phones by section and index. */
  phones: {
    officeUsers: string[];
    distributors: string[];
    drivers: string[];
    customers: string[];
  };
}

/**
 * The whole-file rules (no database), in section order: logins' phones are Pakistani mobiles and unique
 * across office users, shops and drivers; one cylinder type per size; each shop's customers' phones are
 * mobiles (CLIENT_PHONE_INVALID) and unique per shop; opening balances need `--test`.
 */
export function checkSetupFile(file: PilotSetupFile, raw: unknown, options: { test: boolean }): CheckedSetupFile | PilotRefusal {
  const logins = new Map<string, JsonPath>();
  const loginPhone = (section: 'officeUsers' | 'distributors' | 'drivers', index: number, given: string): string | PilotRefusal => {
    const where: JsonPath = [section, index, 'phone'];
    const label = entryLabel(raw, [section, index]);
    const phone = normalizePkPhone(given);
    if (!phone) return PilotRefusal.field(where, 'INVALID_PHONE', { label });
    const earlier = logins.get(phone);
    if (earlier) return PilotRefusal.field(where, 'DUPLICATE_ITEM', { label, detail: `The same phone is at ${pathText(earlier)}: one phone signs in one account.` });
    logins.set(phone, where);
    return phone;
  };

  const phones: CheckedSetupFile['phones'] = { officeUsers: [], distributors: [], drivers: [], customers: [] };
  for (const [index, user] of file.officeUsers.entries()) {
    const phone = loginPhone('officeUsers', index, user.phone);
    if (phone instanceof PilotRefusal) return phone;
    phones.officeUsers.push(phone);
  }
  for (const [index, shop] of file.distributors.entries()) {
    const phone = loginPhone('distributors', index, shop.phone);
    if (phone instanceof PilotRefusal) return phone;
    phones.distributors.push(phone);
  }
  const weights = new Map<number, number>();
  for (const [index, type] of file.cylinderTypes.entries()) {
    const earlier = weights.get(type.weightKg);
    if (earlier !== undefined) {
      return PilotRefusal.field(['cylinderTypes', index, 'weightKg'], 'DUPLICATE_ITEM', {
        label: type.code,
        detail: `cylinderTypes[${earlier}] is ${type.weightKg} kg too: one cylinder type per size.`,
      });
    }
    weights.set(type.weightKg, index);
  }
  for (const [index, driver] of file.drivers.entries()) {
    const phone = loginPhone('drivers', index, driver.phone);
    if (phone instanceof PilotRefusal) return phone;
    phones.drivers.push(phone);
  }
  const customerPhones = new Map<string, number>();
  for (const [index, customer] of file.customers.entries()) {
    const where: JsonPath = ['customers', index, 'phone'];
    const phone = normalizePkPhone(customer.phone);
    if (!phone) return PilotRefusal.of(where, 'CLIENT_PHONE_INVALID', { label: customer.name });
    const key = `${customer.distributor.trim().toUpperCase()}|${phone}`;
    const earlier = customerPhones.get(key);
    if (earlier !== undefined) {
      return PilotRefusal.field(where, 'DUPLICATE_ITEM', { label: customer.name, detail: `customers[${earlier}] has the same phone for ${customer.distributor}.` });
    }
    customerPhones.set(key, index);
    phones.customers.push(phone);
  }
  if (file.openingBalances.length > 0 && !options.test) {
    return PilotRefusal.field(['openingBalances', 0], 'NOT_ALLOWED', {
      label: file.openingBalances[0].distributor,
      detail: 'Opening balances are for a test server: run with --test. On live, balances come only from top-ups and office corrections.',
    });
  }
  return { file, phones };
}
