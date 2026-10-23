import { SETTING_KEYS, type SettingKey } from '@smartfleet/shared-types';
import i18n from '../../i18n';
import { formatRs } from '../../i18n/format';

/**
 * Settings in plain words (UX_ADMIN §2.8, §2.9): the label of every key and its value as people read it,
 * shared by the Settings page (its review dialog) and the Activity log, so neither shows a key name, an
 * enum value or a paisa number ("Top-up maximum: Rs 50,000 → Rs 75,000").
 */

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && (SETTING_KEYS as readonly string[]).includes(value);
}

/** "Top-up maximum" for `topup.maxPaisa`. */
export function settingLabel(key: SettingKey): string {
  return i18n.t(`settings:labels.${key}`);
}

type Formatter = (value: unknown) => string | null;

const onOff: Formatter = (value) =>
  typeof value === 'boolean' ? i18n.t(value ? 'settings:values.on' : 'settings:values.off') : null;

const money: Formatter = (value) => (typeof value === 'number' && Number.isSafeInteger(value) ? formatRs(value) : null);

const moneyOrNoLimit: Formatter = (value) => (value === null ? i18n.t('settings:values.noLimit') : money(value));

const wholeNumber: Formatter = (value) => (typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null);

const textOrNotSet: Formatter = (value) => {
  if (value === null) return i18n.t('settings:values.notSet');
  return typeof value === 'string' ? value : null;
};

const plainText: Formatter = (value) => (typeof value === 'string' ? value : null);

const hours: Formatter = (value) => {
  if (typeof value !== 'object' || value === null) return null;
  const { from, to } = value as { from?: unknown; to?: unknown };
  return typeof from === 'string' && typeof to === 'string' ? i18n.t('settings:values.hours', { from, to }) : null;
};

const moneyList: Formatter = (value) => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts = value.map((item) => money(item));
  return parts.every((part): part is string => part !== null) ? parts.join(', ') : null;
};

const deliveryStartedAt: Formatter = (value) =>
  value === 'FIRST_LOAD_SCAN' || value === 'DRIVER_ASSIGNED' || value === 'LEFT_STORE'
    ? i18n.t(`settings:options.deliveryStartedAt.${value}`)
    : null;

const onAmountMismatch: Formatter = (value) =>
  value === 'CREDIT_BANK_AMOUNT' || value === 'REJECT' ? i18n.t(`settings:options.onAmountMismatch.${value}`) : null;

/** No words for it (an account, a role list, a reserved object): the sentence names the setting only. */
const notShown: Formatter = () => null;

/** How each key's value reads. Values come from JSON (the audit diff or `GET /settings`), so each is checked. */
const FORMATTERS: { readonly [K in SettingKey]: Formatter } = {
  'dispatch.autoAssign.enabled': onOff,
  'auth.otpLogin.enabled': onOff,
  'auth.lockedRoles': notShown,
  'features.transfers': onOff,
  'features.fuelRefills': onOff,
  'features.accessories': onOff,
  'features.support': onOff,
  'features.clientApp': onOff,
  'app.minVersion.driver': plainText,
  'app.minVersion.distributor': plainText,
  'orders.deliveryStartedAt': deliveryStartedAt,
  'orders.maxCylindersPerOrder': wholeNumber,
  'pricing.deliveryStrategy': notShown,
  'wallet.maxBalancePaisa': moneyOrNoLimit,
  'wallet.lowBalancePaisa': money,
  'topup.minPaisa': money,
  'topup.maxPaisa': money,
  'topup.quickAmountsPaisa': moneyList,
  'topup.maxPendingPerDistributor': wholeNumber,
  'topup.onAmountMismatch': onAmountMismatch,
  'topup.checkingHours': hours,
  'topup.account': notShown,
  'topup.secondApproval': notShown,
  'refill.maxCylinders': wholeNumber,
  'refill.deliveryCost': notShown,
  'support.phone': textOrNotSet,
  'support.whatsApp': textOrNotSet,
  'support.hours': textOrNotSet,
  'day.timezone': plainText,
  'day.cutoffLocalTime': plainText,
  'confirmation.enabled': onOff,
  'confirmation.linkTtlHours': wholeNumber,
  'confirmation.caseOnAnswers': notShown,
  'messaging.testMode': onOff,
  'messaging.allowlist': notShown,
  'custody.typedEntry.enabled': onOff,
  'custody.forgottenInPolicy': notShown,
  'trip.allowFinishWithLeftovers': onOff,
  'walkIn.counterSwap.enabled': onOff,
  'dayEnd.enabled': onOff,
};

/** A value in words ("Rs 75,000", "On", "First load scan at the store"), or null when it has none. */
export function formatSettingValue(key: SettingKey, value: unknown): string | null {
  return FORMATTERS[key](value);
}

/** Key-order-independent JSON, to compare a draft with the stored value. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}
