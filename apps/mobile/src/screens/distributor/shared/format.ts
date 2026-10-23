import type { TFunction } from 'i18next';
import type { ClientAddressDto, ClientDto, OrderDto, OrderListTab } from '@smartfleet/shared-types';
import {
  formatDayLabel,
  formatPkPhone,
  formatPkTime,
  formatRs,
  localDate,
  PK_TIME_ZONE,
  toAsciiDigits,
  toPaisa,
  wallClock,
  type PaisaLike,
  type TimeInput,
  type WhenTranslate,
} from '@smartfleet/shared-utils';

/**
 * Small formatting rules shared by the shop screens. Money stays integer paisa: amounts are compared
 * and subtracted with `toPaisa` (which asserts a safe integer) and printed only by `formatRs`.
 *
 * This module imports only the shared packages (no React Native, no i18n), so the API's unit tests
 * can load it on its own (apps/api/test/unit/ui/mobile-logic.spec.ts).
 */

/** The amount in paisa, or 0 when it is missing or malformed. */
export function paisaOrZero(value: PaisaLike | null | undefined): number {
  if (value === null || value === undefined) return 0;
  try {
    return toPaisa(value);
  } catch {
    return 0;
  }
}

/** True when an amount is above Rs 0. */
export function isPositivePaisa(value: PaisaLike | null | undefined): boolean {
  return paisaOrZero(value) > 0;
}

/** "Rs 330" for an amount, or "—" when it is missing or malformed (a bad value never breaks a list). */
export function feeText(value: PaisaLike | null | undefined): string {
  try {
    return formatRs(value);
  } catch {
    return formatRs(null);
  }
}

/** `a − b` as a paisa digit string (signed), exact in integer paisa. */
export function subtractPaisa(a: PaisaLike, b: PaisaLike): string {
  return String(paisaOrZero(a) - paisaOrZero(b));
}

/** "11.80" → "11.8 kg", for a size the server sent without a label. */
export function sizeLabelFromWeight(weightKg: string | number, t: TFunction): string {
  const text = String(weightKg).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return text;
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return t('orders.sizeLabel', { weight: fraction ? `${match[1]}.${fraction}` : match[1] });
}

/** A number to sort sizes by weight (not money). */
export function weightSortKey(weightKg: string | number): number {
  const value = Number.parseFloat(String(weightKg));
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

/**
 * A list row's time (shop spec §3.4): "10:46 am" when it is today, otherwise "Yesterday" or
 * "Mon 19 Oct", in Asia/Karachi. Detail screens keep `formatWhen` ("Today, 10:46 am"). Pass the app's
 * `whenTranslate` (i18n) for the day words.
 */
export function rowTime(at: TimeInput, t?: WhenTranslate, now: TimeInput = Date.now()): string {
  return localDate(at) === localDate(now) ? formatPkTime(at) : formatDayLabel(at, now, t);
}

/** The parts of a delivery cost: a quote, a price applied to counts, or an order's stored copy. */
export interface CostLike {
  basePaisa: PaisaLike;
  totalPaisa: PaisaLike;
  lines: readonly { sizeLabel: string; count: number; perCylinderPaisa: PaisaLike }[];
}

/**
 * The cost's parts as a data-only caption under the big total (shop spec §3.5, §P): "Rs 250 + 2 ×
 * Rs 40 + 1 × Rs 150", with the sizes that cost nothing left out. Null when no size adds to the cost
 * (the total says it all) or the cost is Rs 0. Never "=", brackets or zone names.
 */
export function costParts(cost: CostLike, t: TFunction): string | null {
  if (!isPositivePaisa(cost.totalPaisa)) return null;
  const lineParts = cost.lines
    .filter((line) => line.count > 0 && isPositivePaisa(line.perCylinderPaisa))
    .map((line) => t('orders.new.costLine', { count: line.count, amount: formatRs(line.perCylinderPaisa) }));
  if (lineParts.length === 0) return null;
  const parts = isPositivePaisa(cost.basePaisa)
    ? [t('orders.new.costBase', { amount: formatRs(cost.basePaisa) }), ...lineParts]
    : lineParts;
  return parts.join(t('orders.new.costJoin'));
}

/** An order's stored cost as a {@link CostLike}, or null for a legacy order without a breakdown. */
export function orderCost(order: OrderDto): CostLike | null {
  const breakdown = order.fee.breakdown;
  if (!breakdown) return null;
  return { basePaisa: breakdown.basePaisa, totalPaisa: order.fee.totalPaisa, lines: breakdown.lines };
}

/** "2 × 11.8 kg, 1 × 45.4 kg" for an order's lines. */
export function itemsText(lines: OrderDto['lines'], t: TFunction): string {
  return lines
    .map((line) => t('orders.list.item', { count: line.fullCount, size: line.sizeLabel }))
    .join(t('orders.list.itemsJoin'));
}

/** "0300 1234567": every phone on screen is written this way (UX_MOBILE S1). */
export function phoneText(phone: string | null | undefined): string {
  return formatPkPhone(phone);
}

function minutesOfDay(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * True while the office checks top-ups (`topup.checkingHours`, local "HH:mm" in the business time
 * zone). A window past midnight ("21:00"–"02:00") is understood; malformed hours count as open.
 */
export function isWithinCheckingHours(
  hours: { from: string; to: string },
  timeZone: string,
  now: number = Date.now(),
): boolean {
  const from = minutesOfDay(hours.from);
  const to = minutesOfDay(hours.to);
  if (from === null || to === null || from === to) return true;
  let clock: { hour: number; minute: number };
  try {
    clock = wallClock(now, timeZone);
  } catch {
    clock = wallClock(now, PK_TIME_ZONE);
  }
  const current = clock.hour * 60 + clock.minute;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

/** "ahmed raza" → "Ahmed Raza": the first letter of each word upper-cased, the rest as typed. */
export function capitaliseWords(text: string): string {
  return text.replace(/(^|\s)(\S)/g, (_, space: string, first: string) => `${space}${first.toUpperCase()}`);
}

/** The address an order goes to by default: the first with a price, else the first one. */
export function defaultAddress(client: ClientDto): ClientAddressDto | null {
  return client.addresses.find((address) => address.priceStatus === 'SET') ?? client.addresses[0] ?? null;
}

/**
 * Why an address can't take an order now (shop spec §K): no address, no delivery price in its zone,
 * or outside every zone. `none` means it can be ordered to.
 */
export type AddressBlock = 'none' | 'noAddress' | 'noPrice' | 'outside';

export function addressBlock(address: ClientAddressDto | null | undefined): AddressBlock {
  if (!address) return 'noAddress';
  if (address.priceStatus === 'SET') return 'none';
  if (address.priceStatus === 'NOT_SET') return 'noPrice';
  return 'outside';
}

/**
 * Customer search on the phone (GET /clients has no search): part of the name or area in any letter
 * case, or 3+ digits of the mobile in either form ("1234567", "0300", "+92300").
 */
export function matchesCustomer(client: ClientDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (client.name.toLowerCase().includes(q)) return true;
  if ((client.area ?? '').toLowerCase().includes(q)) return true;
  const digits = toAsciiDigits(q).replace(/\D/g, '');
  if (digits.length < 3) return false;
  const stored = client.phone.replace(/\D/g, '');
  const local = formatPkPhone(client.phone, 'compact').replace(/\D/g, '');
  return stored.includes(digits) || local.includes(digits);
}

/** Customers by name, A–Z, ignoring letter case. */
export function byName(a: ClientDto, b: ClientDto): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function newestFirst(orders: readonly (readonly OrderDto[] | undefined)[]): OrderDto[] {
  return orders
    .flatMap((list) => list ?? [])
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * "Recent" on Customers and New order step 1 (shop spec §K): the customers of the newest orders,
 * newest first, each once, at most `limit`. Takes the first pages of the Active and Done lists.
 */
export function recentCustomerIds(orders: readonly (readonly OrderDto[] | undefined)[], limit = 5): string[] {
  const ids: string[] = [];
  for (const order of newestFirst(orders)) {
    if (!ids.includes(order.client.id)) ids.push(order.client.id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/** This customer's newest order in the given lists (New order's "Same as last time"), or null. */
export function lastOrderOf(clientId: string, orders: readonly (readonly OrderDto[] | undefined)[]): OrderDto | null {
  return newestFirst(orders).find((order) => order.client.id === clientId) ?? null;
}

/**
 * The n of "Active (n)" on My orders (UX_MOBILE S10, ORD-005): the active list's rows once it is fully
 * loaded, because that list polls every 30 seconds and the home count doesn't, so a driver's delivery
 * or the office's cancel would leave the count behind the rows. On Done, or while more pages are left,
 * the home count. Null while neither is known.
 */
export function activeTabCount({
  tab,
  rowCount,
  hasMorePages,
  homeCount,
}: {
  tab: OrderListTab;
  /** The rows of the list on screen, or null before its first page. */
  rowCount: number | null;
  hasMorePages: boolean;
  /** `orders.active` from `GET /distributor/home`, once loaded. */
  homeCount: number | null | undefined;
}): number | null {
  if (tab === 'active' && rowCount !== null && !hasMorePages) return rowCount;
  return homeCount ?? null;
}
