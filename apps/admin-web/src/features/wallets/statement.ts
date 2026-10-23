import type { StatementItem, StatementKind } from '@smartfleet/shared-types';
import { localDate } from '@smartfleet/shared-utils';
import type { WalletSearch } from '../../app/search';
import i18n from '../../i18n';
import { formatTime } from '../../i18n/format';
import type { DateRange } from '../../ui';

/**
 * The wallet history (UX_ADMIN §2.6): its filters, its rows in plain words, and the CSV statement built
 * in the browser from the same words.
 */

/** The type filter (G01-10): its value is the `?kind=` the URL keeps; Corrections also sends OPENING_BALANCE. */
export const HISTORY_TYPES = ['all', 'TOPUP_ADDED', 'DELIVERY_COST', 'DELIVERY_COST_RETURNED', 'CORRECTION'] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];

const TYPE_KINDS: { readonly [T in HistoryType]: readonly StatementKind[] } = {
  all: [],
  TOPUP_ADDED: ['TOPUP_ADDED'],
  DELIVERY_COST: ['DELIVERY_COST'],
  DELIVERY_COST_RETURNED: ['DELIVERY_COST_RETURNED'],
  CORRECTION: ['CORRECTION', 'OPENING_BALANCE'],
};

/** The filter a `?kind=` names; an opening entry belongs with the corrections, other kinds show under All. */
export function historyTypeOf(kind: StatementKind | undefined): HistoryType {
  if (kind === 'OPENING_BALANCE') return 'CORRECTION';
  return kind && (HISTORY_TYPES as readonly string[]).includes(kind) ? (kind as HistoryType) : 'all';
}

export function kindsOf(type: HistoryType): readonly StatementKind[] {
  return TYPE_KINDS[type];
}

/** The `?kind=` for a filter (All leaves it out). */
export function kindParam(type: HistoryType): StatementKind | undefined {
  return type === 'all' ? undefined : type;
}

/** The search params of a range: This month is the default, so it leaves the dates out (historyDates.ts). */
export function searchForRange(range: DateRange): Pick<WalletSearch, 'from' | 'to'> {
  if (range.preset === 'thisMonth') return { from: undefined, to: undefined };
  return { from: range.from || undefined, to: range.to || undefined };
}

/** The dates in order (a reversed custom range is read the right way round). */
export function orderedDates(range: DateRange): { from: string; to: string } {
  return range.from <= range.to ? { from: range.from, to: range.to } : { from: range.to, to: range.from };
}

/** "What happened" for one history row (UX_ADMIN §2.6), never a code. */
export function historyWords(item: StatementItem): string {
  const t = i18n.t;
  const no = item.subject?.shortCode ?? null;
  const note = item.note?.trim() || null;
  switch (item.kind) {
    case 'TOPUP_ADDED': {
      const ref = item.subject?.bankReference?.trim() || null;
      if (no && ref) return t('wallets:history.rows.topup', { no, ref });
      return no ? t('wallets:history.rows.topupNoRef', { no }) : t('wallets:history.rows.topupBare');
    }
    case 'DELIVERY_COST': {
      // "Delivery cost · AG-0008 · Usman": the customer tells look-alike rows apart (website spec W13).
      const customer = item.subject?.clientName?.trim() || null;
      if (no && customer) return t('wallets:history.rows.deliveryCostCustomer', { no, customer });
      return no ? t('wallets:history.rows.deliveryCost', { no }) : t('wallets:history.rows.deliveryCostBare');
    }
    case 'DELIVERY_COST_RETURNED':
      return no ? t('wallets:history.rows.returned', { no }) : t('wallets:history.rows.returnedBare');
    case 'CORRECTION': {
      const reason = t(`wallets:correction.reasons.${item.reasonCode ?? 'OTHER'}`);
      return note ? t('wallets:history.rows.correction', { reason, note }) : t('wallets:history.rows.correctionNoNote', { reason });
    }
    case 'OPENING_BALANCE':
      // An office user recorded it as a correction: its note follows (G01-04).
      return item.by && note ? t('wallets:history.rows.openingNote', { note }) : t('wallets:history.rows.opening');
    case 'REFILL_DELIVERY_COST':
      return no ? t('wallets:history.rows.refillCost', { no }) : t('wallets:history.rows.refillCostBare');
    case 'LEGACY':
    default:
      return t('wallets:history.rows.legacy');
  }
}

/** The record a history row opens: its top-up or its order (refill rows don't open, W13). */
export type HistoryTarget = { kind: 'TOPUP' | 'ORDER'; id: string };

export function historyTarget(item: StatementItem): HistoryTarget | null {
  const subject = item.subject;
  if (!subject?.id) return null;
  return subject.type === 'TOPUP' || subject.type === 'ORDER' ? { kind: subject.type, id: subject.id } : null;
}

// ---- The CSV statement ------------------------------------------------------------------------------

/** A statement holds at most this many rows ("Pick a shorter date range"). */
export const STATEMENT_MAX_ROWS = 2000;

/** "-48000" → "-480", "345050" → "3450.50": rupees as Excel reads a number, with no separators. */
export function rupeesForCsv(paisa: string): string {
  const negative = paisa.startsWith('-');
  const digits = (negative ? paisa.slice(1) : paisa).replace(/^0+(?=\d)/, '').padStart(3, '0');
  const rupees = digits.slice(0, -2).replace(/^0+(?=\d)/, '');
  const cents = digits.slice(-2);
  const text = cents === '00' ? rupees : `${rupees}.${cents}`;
  return negative && text !== '0' ? `-${text}` : text;
}

/** A text cell: quoted when needed, and never read as a formula by a spreadsheet. */
function textCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The statement as CSV text: Date, Time, What happened, Reference, Change (Rs), Balance after (Rs), By. */
export function statementCsv(rows: readonly StatementItem[]): string {
  const t = i18n.t;
  const header = [
    t('wallets:statement.columns.date'),
    t('wallets:statement.columns.time'),
    t('wallets:statement.columns.what'),
    t('wallets:statement.columns.reference'),
    t('wallets:statement.columns.change'),
    t('wallets:statement.columns.balanceAfter'),
    t('wallets:statement.columns.by'),
  ].map(textCell);
  const lines = rows.map((item) =>
    [
      textCell(localDate(item.at)),
      textCell(formatTime(item.at)),
      textCell(historyWords(item)),
      textCell(item.subject?.shortCode ?? ''),
      rupeesForCsv(item.amountPaisa),
      rupeesForCsv(item.balanceAfterPaisa),
      textCell(item.by?.name ?? ''),
    ].join(','),
  );
  return [header.join(','), ...lines].join('\r\n');
}

/** "ali-gas-wallet-2026-10.csv" for a month, else "ali-gas-wallet-2026-10-01-to-2026-11-15.csv". */
export function statementFileName(businessName: string, range: { from: string; to: string }): string {
  const slug =
    businessName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'distributor';
  const period = range.from.slice(0, 7) === range.to.slice(0, 7) ? range.from.slice(0, 7) : `${range.from}-to-${range.to}`;
  return `${slug}-wallet-${period}.csv`;
}

/** Saves text as a file from the browser (with a byte-order mark, so spreadsheets read "—" and "·"). */
export function downloadTextFile(fileName: string, text: string, mimeType = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['﻿', text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
