import type { AuditLogDto } from '@smartfleet/shared-types';
import type { ActivityArea } from '../../app/search';
import { translateDynamic } from '../../i18n';
import { actionInWords, activityParams, activityWhy } from '../../ui';
import { formatSettingValue, isSettingKey, settingLabel } from '../settings/values';

/**
 * The Activity log's sentences (UX_ADMIN §2.9), read from `activity:<action>` (i18n/en/activity.ts).
 *
 * The shared `activitySentence(row)` in src/ui renders a row with its own diff fields only. The page knows
 * more, so it adds it here: the distributor's name for rows that carry only its id (the `_log` variants),
 * a setting's label and its values in words, and which result the nightly wallet check had. It never shows
 * a code, a key name or an id: a sentence that would leave a placeholder or a key path falls back to the
 * action in words.
 */

export interface ActivityContext {
  /** The business name of a distributor id, when the page has loaded the distributors. */
  distributorName?: (distributorId: string) => string | undefined;
}

/** The context variant that adds the distributor's name (`topup.approve_log`). */
const LOG_CONTEXT = 'log';

/** Left-over template syntax or a nested key path: the row lacks a field its sentence needs. */
const UNFILLED = /\{\{|\$t\(|(?:^|[\s(“])(?:parts|reasons)\./;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Params = Record<string, string | number | boolean>;

/** `setting.update` `{ key, from, to }`: the label, and both values when they have words. */
function settingParams(row: AuditLogDto, params: Params): Params {
  const diff = isRecord(row.diff) ? row.diff : {};
  const key = diff.key;
  if (!isSettingKey(key)) return params;
  const from = formatSettingValue(key, diff.from);
  const to = formatSettingValue(key, diff.to);
  const setting = settingLabel(key);
  if (from !== null && to !== null) return { ...params, setting, from, to, context: 'values' };
  return { ...params, setting, context: 'named' };
}

/** `wallet.check` `{ checked, mismatches }`: "all match", or how many don't. */
function walletCheckParams(params: Params): Params {
  const checked = typeof params.checked === 'number' ? params.checked : null;
  const mismatches = typeof params.mismatches === 'number' ? params.mismatches : null;
  if (checked === null || mismatches === null) return params;
  return mismatches === 0
    ? { ...params, context: 'clean', count: checked }
    : { ...params, context: 'mismatch', count: mismatches };
}

/** Inc 2 rows about one order: the customer's answer, a new link, a sorted problem. */
const ORDER_NUMBER_ACTIONS: ReadonlySet<string> = new Set(['confirmation.answer', 'confirmation.new_link', 'case.resolve']);

/**
 * The order's number for those rows: the row's `no` when the API writes one, else the customer's link
 * label ("link:AG-0001", the actor of an answer). With it the sentence names the order (`_order`).
 */
function orderNumberParams(row: AuditLogDto, params: Params): Params {
  const fromLink = /^link:(.+)$/.exec(row.actor.label ?? '')?.[1];
  const no = typeof params.no === 'string' && params.no ? params.no : fromLink;
  return no ? { ...params, no, context: 'order' } : params;
}

/** The template params of a row, with what the page adds. */
function sentenceParams(row: AuditLogDto, context: ActivityContext): Params {
  let params: Params = { ...activityParams(row) };
  if (ORDER_NUMBER_ACTIONS.has(row.action)) return orderNumberParams(row, params);
  if (row.action === 'setting.update') params = settingParams(row, params);
  else if (row.action === 'wallet.check') params = walletCheckParams(params);
  else if (params.distributor !== undefined) params = { ...params, context: LOG_CONTEXT };
  else if (row.distributorId) {
    // Rows that don't carry the distributor's name (orders, older money rows) get it from the page.
    const name = context.distributorName?.(row.distributorId);
    if (name) params = { ...params, distributor: name, context: LOG_CONTEXT };
  }
  return params;
}

/** One plain sentence for an audit row; an action without a sentence shows as its code in words. */
export function activityLine(row: AuditLogDto, context: ActivityContext = {}): string {
  if (!row.action.includes('.')) return actionInWords(row.action);
  const text = translateDynamic(`activity:${row.action}`, sentenceParams(row, context));
  if (!text || UNFILLED.test(text)) return actionInWords(row.action);
  return text;
}

/** The Why column: the shared rule of `<ActivityList />` (what was typed, or the reason code in words). */
export { activityWhy };

/** The record a row opens (website spec W40): an order, a top-up, a distributor, or a wallet for its money rows. */
export type ActivityTarget =
  | { kind: 'order'; id: string }
  | { kind: 'topup'; id: string }
  | { kind: 'distributor'; id: string }
  | { kind: 'wallet'; id: string };

/** Which record a row is about, from its `resourceType` (the API writes "Order" and "order" alike); null for the rest. */
export function activityTarget(row: AuditLogDto): ActivityTarget | null {
  const id = row.resourceId;
  if (!id) return null;
  switch (row.resourceType.toLowerCase()) {
    case 'order':
      return { kind: 'order', id };
    case 'payment':
      return { kind: 'topup', id };
    case 'distributor':
      // A wallet correction is written against the distributor: it opens the wallet it changed.
      return row.action.startsWith('wallet.') ? { kind: 'wallet', id } : { kind: 'distributor', id };
    default:
      return null;
  }
}

/** The actions behind each "What" filter (UX_ADMIN §2.9), by their prefix. */
const AREA_PREFIXES: { readonly [A in ActivityArea]: readonly string[] } = {
  money: ['topup.', 'wallet.', 'price.'],
  orders: ['order.', 'trip.', 'refill.', 'cylinders.', 'custody.', 'confirmation.', 'case.', 'day.'],
  expenses: ['expense.', 'expense_type.'],
  settings: ['setting.', 'zone.', 'pilot.'],
  people: ['user.', 'distributor.', 'driver.', 'client.'],
};

/** Which "What" filter an action belongs to; null for an action the filters don't name. */
export function areaOf(action: string): ActivityArea | null {
  for (const area of Object.keys(AREA_PREFIXES) as ActivityArea[]) {
    if (AREA_PREFIXES[area].some((prefix) => action.startsWith(prefix))) return area;
  }
  return null;
}
