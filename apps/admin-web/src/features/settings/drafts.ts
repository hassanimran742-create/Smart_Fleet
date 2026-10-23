import type { AnySettingRow } from '@smartfleet/shared-types';
import i18n from '../../i18n';
import { formatRs } from '../../i18n/format';
import type { FieldDef } from './fields';

/**
 * What a Settings row holds while it is being edited, and how it becomes the value `PATCH /settings/:key`
 * sends. The server checks every value again (SETTING_INVALID_VALUE); these checks only say early what it
 * would refuse, and an empty box says what to type (website spec §1.8).
 */
export type Draft =
  /** A rupee box: what was typed (to tell blank from not-an-amount) and its paisa value. */
  | { kind: 'money'; text: string; paisa: string | null }
  /** "No limit" (`on` false) or "Set a limit" with its rupee box. */
  | { kind: 'limit'; on: boolean; text: string; paisa: string | null }
  | { kind: 'text'; text: string }
  | { kind: 'flag'; value: boolean }
  | { kind: 'choice'; value: string }
  | { kind: 'hours'; from: string; to: string };

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
/** A Pakistani number as PhoneInput hands it over: "+92" and 10 digits (E.164). */
const PK_PHONE = /^\+92\d{10}$/;
const WHOLE = /^\d{1,9}$/;

function moneyDraft(value: unknown): { text: string; paisa: string | null } {
  return typeof value === 'number' ? { text: String(value / 100), paisa: String(value) } : { text: '', paisa: null };
}

/** The draft of a row that hasn't been touched: its stored value. */
export function draftFromValue(field: FieldDef, value: unknown): Draft {
  switch (field.control.kind) {
    case 'money':
      return { kind: 'money', ...moneyDraft(value) };
    case 'limit':
      return { kind: 'limit', on: typeof value === 'number', ...moneyDraft(value) };
    case 'switch':
      return { kind: 'flag', value: value === true };
    case 'deliveryStartedAt':
    case 'onAmountMismatch':
      return { kind: 'choice', value: typeof value === 'string' ? value : '' };
    case 'hours': {
      const hours = (value ?? {}) as { from?: unknown; to?: unknown };
      return { kind: 'hours', from: typeof hours.from === 'string' ? hours.from : '', to: typeof hours.to === 'string' ? hours.to : '' };
    }
    default:
      return { kind: 'text', text: value === null || value === undefined ? '' : String(value) };
  }
}

/** A rupee box's value in paisa, within the row's bounds. */
function parseMoney(text: string, paisa: string | null, row: AnySettingRow, allowZero: boolean, missing: string): Parsed {
  const t = i18n.t;
  if (text.trim() === '') return { ok: false, error: missing };
  if (paisa === null || !WHOLE.test(paisa)) return { ok: false, error: t('validation:AMOUNT_NOT_WHOLE_RUPEES') };
  const amount = Number(paisa);
  const floor = row.min ?? (allowZero ? 0 : 100);
  if (amount < floor) return { ok: false, error: t('validation:AMOUNT_TOO_SMALL', { min: formatRs(floor) }) };
  if (row.max !== undefined && amount > row.max) return { ok: false, error: t('validation:AMOUNT_TOO_LARGE', { max: formatRs(row.max) }) };
  return { ok: true, value: amount };
}

/** The value a draft stands for, or the reason it isn't one yet. */
export function parseDraft(field: FieldDef, draft: Draft, row: AnySettingRow): Parsed {
  const t = i18n.t;
  const control = field.control;
  if (control.kind === 'money' && draft.kind === 'money') {
    return parseMoney(draft.text, draft.paisa, row, control.allowZero === true, t('settings:errors.amountMissing'));
  }
  if (control.kind === 'limit' && draft.kind === 'limit') {
    if (!draft.on) return { ok: true, value: null };
    return parseMoney(draft.text, draft.paisa, row, false, t('settings:errors.limitMissing'));
  }
  if (control.kind === 'integer' && draft.kind === 'text') {
    const text = draft.text.trim();
    if (text === '') return { ok: false, error: t('settings:errors.numberMissing') };
    if (!WHOLE.test(text)) return { ok: false, error: t('validation:NOT_INTEGER') };
    const value = Number(text);
    if (row.min !== undefined && value < row.min) return { ok: false, error: t('validation:TOO_SMALL', { min: row.min }) };
    if (row.max !== undefined && value > row.max) return { ok: false, error: t('validation:TOO_LARGE', { max: row.max }) };
    return { ok: true, value };
  }
  if (control.kind === 'phone' && draft.kind === 'text') {
    const text = draft.text.trim();
    if (text === '') return { ok: true, value: null };
    return PK_PHONE.test(text) ? { ok: true, value: text } : { ok: false, error: t('settings:errors.phone') };
  }
  if (control.kind === 'text' && draft.kind === 'text') {
    const text = draft.text.trim();
    if (text === '') return { ok: true, value: null };
    if (text.length > control.maxLength) return { ok: false, error: t('validation:TOO_LONG', { max: control.maxLength }) };
    return { ok: true, value: text };
  }
  if (control.kind === 'version' && draft.kind === 'text') {
    const text = draft.text.trim();
    return SEMVER.test(text) ? { ok: true, value: text } : { ok: false, error: t('settings:errors.version') };
  }
  if (control.kind === 'hours' && draft.kind === 'hours') {
    if (!LOCAL_TIME.test(draft.from) || !LOCAL_TIME.test(draft.to)) return { ok: false, error: t('settings:errors.time') };
    if (draft.from === draft.to) return { ok: false, error: t('settings:errors.sameHours') };
    return { ok: true, value: { from: draft.from, to: draft.to } };
  }
  if (control.kind === 'switch' && draft.kind === 'flag') return { ok: true, value: draft.value };
  if ((control.kind === 'deliveryStartedAt' || control.kind === 'onAmountMismatch') && draft.kind === 'choice') {
    const options = row.options ?? [];
    return options.length === 0 || options.includes(draft.value)
      ? { ok: true, value: draft.value }
      : { ok: false, error: t('validation:INVALID_CHOICE') };
  }
  return { ok: false, error: t('validation:INVALID_VALUE') };
}
