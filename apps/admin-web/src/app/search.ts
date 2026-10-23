import {
  ADMIN_TOPUP_TABS,
  ORDER_BOARD_TABS,
  STATEMENT_KINDS,
  type AdminTopupTab,
  type IsoDate,
  type OrderBoardTab,
  type StatementKind,
  type UUID,
} from '@smartfleet/shared-types';
import { isIsoDate } from '@smartfleet/shared-utils';

/**
 * Search params of every route (UX_ADMIN §1.2: tabs and filters live in the URL, checked with
 * `validateSearch`). Every key is optional, so links never have to repeat defaults; a page reads a
 * missing key as its default (for example the first tab). Bad values are dropped, never thrown.
 *
 * The URL keeps plain text (`?tab=needs-driver&q=0142`): app/router.tsx parses search params as
 * strings, so each validator turns them into the right type here.
 */

type RawSearch = Record<string, unknown>;

const MAX_TEXT = 120;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A trimmed, non-empty string (numbers are kept as text: a search for "0142" stays "0142"). */
export function searchText(value: unknown, max = MAX_TEXT): string | undefined {
  const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
  const trimmed = text?.trim().slice(0, max);
  return trimmed ? trimmed : undefined;
}

export function searchChoice<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function searchFlag(value: unknown): true | undefined {
  return value === true || value === 'true' || value === '1' ? true : undefined;
}

export function searchDate(value: unknown): IsoDate | undefined {
  return isIsoDate(value) ? value : undefined;
}

export function searchId(value: unknown): UUID | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
}

/** `/orders?tab=&q=&distributor=` */
export interface OrdersSearch {
  tab?: OrderBoardTab;
  q?: string;
  distributor?: UUID;
}
export function validateOrdersSearch(raw: RawSearch): OrdersSearch {
  return { tab: searchChoice(ORDER_BOARD_TABS, raw.tab), q: searchText(raw.q), distributor: searchId(raw.distributor) };
}

/** `/topups?tab=&q=` */
export interface TopupsSearch {
  tab?: AdminTopupTab;
  q?: string;
}
export function validateTopupsSearch(raw: RawSearch): TopupsSearch {
  return { tab: searchChoice(ADMIN_TOPUP_TABS, raw.tab), q: searchText(raw.q) };
}

/** `/wallets/$distributorId?from&to&kind`: the history filters. */
export interface WalletSearch {
  from?: IsoDate;
  to?: IsoDate;
  kind?: StatementKind;
}
export function validateWalletSearch(raw: RawSearch): WalletSearch {
  return { from: searchDate(raw.from), to: searchDate(raw.to), kind: searchChoice(STATEMENT_KINDS, raw.kind) };
}

/** `/prices/$distributorId?missing&archived` */
export interface PricesSearch {
  /** "Show only missing". */
  missing?: true;
  /** "Show archived zones". */
  archived?: true;
}
export function validatePricesSearch(raw: RawSearch): PricesSearch {
  return { missing: searchFlag(raw.missing), archived: searchFlag(raw.archived) };
}

/** `/distributors?suspended` */
export interface DistributorsSearch {
  /** "Show suspended". */
  suspended?: true;
}
export function validateDistributorsSearch(raw: RawSearch): DistributorsSearch {
  return { suspended: searchFlag(raw.suspended) };
}

export const EXPENSES_TABS = ['expenses', 'fuel-logs'] as const;
export type ExpensesTab = (typeof EXPENSES_TABS)[number];

/** `/expenses?tab=expenses|fuel-logs&from&to&type&van&driver&removed` */
export interface ExpensesSearch {
  tab?: ExpensesTab;
  from?: IsoDate;
  to?: IsoDate;
  /** An expense type id. */
  type?: UUID;
  /** A vehicle id. */
  van?: UUID;
  /** A driver id. */
  driver?: UUID;
  /** "Show removed". */
  removed?: true;
}
export function validateExpensesSearch(raw: RawSearch): ExpensesSearch {
  return {
    tab: searchChoice(EXPENSES_TABS, raw.tab),
    from: searchDate(raw.from),
    to: searchDate(raw.to),
    type: searchId(raw.type),
    van: searchId(raw.van),
    driver: searchId(raw.driver),
    removed: searchFlag(raw.removed),
  };
}

export const SETTINGS_SECTIONS = ['money', 'orders', 'refills', 'modules', 'account', 'support', 'versions'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** `/settings?section=` */
export interface SettingsSearch {
  section?: SettingsSection;
}
export function validateSettingsSearch(raw: RawSearch): SettingsSearch {
  return { section: searchChoice(SETTINGS_SECTIONS, raw.section) };
}

export const ACTIVITY_AREAS = ['money', 'orders', 'expenses', 'settings', 'people'] as const;
export type ActivityArea = (typeof ACTIVITY_AREAS)[number];

/** `/activity?what&who&from&to` */
export interface ActivitySearch {
  what?: ActivityArea;
  /** A user id. */
  who?: UUID;
  from?: IsoDate;
  to?: IsoDate;
}
export function validateActivitySearch(raw: RawSearch): ActivitySearch {
  return {
    what: searchChoice(ACTIVITY_AREAS, raw.what),
    who: searchId(raw.who),
    from: searchDate(raw.from),
    to: searchDate(raw.to),
  };
}

export const CYLINDERS_TABS = ['stock', 'labels'] as const;
export type CylindersTab = (typeof CYLINDERS_TABS)[number];

/** `/cylinders?tab=stock|labels` (legacy inventory and QR label screens). */
export interface CylindersSearch {
  tab?: CylindersTab;
}
export function validateCylindersSearch(raw: RawSearch): CylindersSearch {
  return { tab: searchChoice(CYLINDERS_TABS, raw.tab) };
}

/** Plain-text search params: `?q=0142` stays the string "0142". */
export function parseSearch(searchStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(searchStr)) out[key] = value;
  return out;
}

/** Writes search params as plain text, leaving out empty values. */
export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
