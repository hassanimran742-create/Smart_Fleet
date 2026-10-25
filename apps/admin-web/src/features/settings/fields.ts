import type { SettingKey } from '@smartfleet/shared-types';
import type { SettingsSection } from '../../app/search';
import type { ModuleId } from '../../app/modules';
import type { settings } from '../../i18n/en/settings';

/**
 * The Settings form (website spec W38, UX_ADMIN §2.8): a fixed list of rows by section, with no
 * server-driven renderer. `GET /settings` gives each row's value, bounds and who changed it; this file
 * says how it is edited.
 */

/** Every leaf path of a nested copy object: `topup.minPaisa`, `dispatch.autoAssign.enabled`, … */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** A row description that exists in i18n/en/settings.ts (`tsc` checks each one). */
export type DescriptionKey = `descriptions.${Leaves<typeof settings.descriptions>}`;

/** The sections of the menu, in page order (Inc 2 adds Customer messages and Scans, UX_ADMIN §3.6). */
export const SECTIONS = ['money', 'orders', 'messages', 'scans', 'modules', 'support', 'account', 'versions'] as const;
export type SectionId = (typeof SECTIONS)[number];

/** The section a `?section=` opens: Refills was folded into Orders and delivery (W38). */
export function sectionOf(value: SettingsSection | undefined): SectionId {
  if (value === undefined) return 'money';
  return value === 'refills' ? 'orders' : value;
}

export type FieldControl =
  /** A rupee amount (settings store paisa as whole numbers). */
  | { kind: 'money'; allowZero?: boolean }
  /** No limit, or a rupee amount: "No limit" / "Set a limit", then the amount (null is no limit). */
  | { kind: 'limit' }
  /** A whole number with its unit after the box ("30 cylinders", "72 hours"). */
  | { kind: 'integer'; unit: 'cylinders' | 'topups' | 'hours' }
  | { kind: 'deliveryStartedAt' }
  | { kind: 'onAmountMismatch' }
  | { kind: 'switch'; module?: ModuleId }
  /** A Pakistani number with "+92" fixed; empty is "not set" (null). */
  | { kind: 'phone' }
  /** Free text; empty is "not set" (null). */
  | { kind: 'text'; maxLength: number; placeholder: 'hours' }
  | { kind: 'version' }
  | { kind: 'hours' }
  /** [Inc 2] The answers that open a problem: toggle chips, several can be on (`confirmation.caseOnAnswers`). */
  | { kind: 'answers' }
  /** [Inc 2] A list of Pakistani numbers with "+ Add phone" (`messaging.allowlist`). */
  | { kind: 'phoneList' }
  /** [Inc 3] When the business day starts: a whole hour from 12 am to 6 am (`day.cutoffLocalTime`). */
  | { kind: 'cutoff' };

/** The answers the chips offer, in this order (UX_ADMIN §3.6); "All received" never opens a problem. */
export const PROBLEM_ANSWERS = ['NO', 'OTHER', 'PARTLY'] as const;

/** The hours "New day starts at" offers: 12 am to 6 am (UX_ADMIN §4.4). */
export const CUTOFF_HOURS = ['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00'] as const;

export interface FieldDef {
  key: SettingKey;
  section: SectionId;
  control: FieldControl;
  description?: DescriptionKey;
}

/** The editable rows, in page order. Read-only blocks (refill cost, company account) are drawn apart. */
export const FIELDS: readonly FieldDef[] = [
  // Money
  { key: 'topup.minPaisa', section: 'money', control: { kind: 'money' } },
  { key: 'topup.maxPaisa', section: 'money', control: { kind: 'money' } },
  { key: 'topup.onAmountMismatch', section: 'money', control: { kind: 'onAmountMismatch' } },
  {
    key: 'topup.maxPendingPerDistributor',
    section: 'money',
    control: { kind: 'integer', unit: 'topups' },
    description: 'descriptions.topup.maxPendingPerDistributor',
  },
  { key: 'wallet.maxBalancePaisa', section: 'money', control: { kind: 'limit' }, description: 'descriptions.wallet.maxBalancePaisa' },
  {
    key: 'wallet.lowBalancePaisa',
    section: 'money',
    control: { kind: 'money', allowZero: true },
    description: 'descriptions.wallet.lowBalancePaisa',
  },
  // Orders and delivery (with the refill rows, once a section of their own)
  {
    key: 'orders.deliveryStartedAt',
    section: 'orders',
    control: { kind: 'deliveryStartedAt' },
    description: 'descriptions.orders.deliveryStartedAt',
  },
  {
    key: 'dispatch.autoAssign.enabled',
    section: 'orders',
    control: { kind: 'switch' },
    description: 'descriptions.dispatch.autoAssign.enabled',
  },
  { key: 'orders.maxCylindersPerOrder', section: 'orders', control: { kind: 'integer', unit: 'cylinders' } },
  { key: 'refill.maxCylinders', section: 'orders', control: { kind: 'integer', unit: 'cylinders' } },
  // [Inc 3] The business day (UX_ADMIN §4.4).
  { key: 'day.cutoffLocalTime', section: 'orders', control: { kind: 'cutoff' }, description: 'descriptions.day.cutoffLocalTime' },
  // [Inc 2] Customer messages (UX_ADMIN §3.6)
  {
    key: 'confirmation.enabled',
    section: 'messages',
    control: { kind: 'switch', module: 'confirmations' },
    description: 'descriptions.confirmation.enabled',
  },
  { key: 'confirmation.caseOnAnswers', section: 'messages', control: { kind: 'answers' } },
  { key: 'confirmation.linkTtlHours', section: 'messages', control: { kind: 'integer', unit: 'hours' } },
  { key: 'messaging.testMode', section: 'messages', control: { kind: 'switch' }, description: 'descriptions.messaging.testMode' },
  { key: 'messaging.allowlist', section: 'messages', control: { kind: 'phoneList' } },
  // [Inc 2] Scans (UX_ADMIN §3.6); "Not scanned at the store" is a read-only block under them.
  {
    key: 'custody.typedEntry.enabled',
    section: 'scans',
    control: { kind: 'switch' },
    description: 'descriptions.custody.typedEntry.enabled',
  },
  {
    key: 'trip.allowFinishWithLeftovers',
    section: 'scans',
    control: { kind: 'switch' },
    description: 'descriptions.trip.allowFinishWithLeftovers',
  },
  // Features
  { key: 'features.transfers', section: 'modules', control: { kind: 'switch', module: 'transfers' } },
  { key: 'features.accessories', section: 'modules', control: { kind: 'switch', module: 'accessories' } },
  { key: 'features.support', section: 'modules', control: { kind: 'switch', module: 'support' } },
  {
    key: 'features.fuelRefills',
    section: 'modules',
    control: { kind: 'switch', module: 'fuelRefills' },
    description: 'descriptions.features.fuelRefills',
  },
  {
    key: 'features.clientApp',
    section: 'modules',
    control: { kind: 'switch', module: 'clientApp' },
    description: 'descriptions.features.clientApp',
  },
  // [Inc 3] UX_ADMIN §4.4
  { key: 'dayEnd.enabled', section: 'modules', control: { kind: 'switch', module: 'dayEnd' }, description: 'descriptions.dayEnd.enabled' },
  // Support
  { key: 'support.phone', section: 'support', control: { kind: 'phone' }, description: 'descriptions.support.phone' },
  { key: 'support.whatsApp', section: 'support', control: { kind: 'phone' }, description: 'descriptions.support.whatsApp' },
  {
    key: 'support.hours',
    section: 'support',
    control: { kind: 'text', maxLength: 60, placeholder: 'hours' },
    description: 'descriptions.support.hours',
  },
  { key: 'topup.checkingHours', section: 'support', control: { kind: 'hours' }, description: 'descriptions.topup.checkingHours' },
  // Tech team
  {
    key: 'app.minVersion.driver',
    section: 'versions',
    control: { kind: 'version' },
    description: 'descriptions.app.minVersion.driver',
  },
  {
    key: 'app.minVersion.distributor',
    section: 'versions',
    control: { kind: 'version' },
    description: 'descriptions.app.minVersion.distributor',
  },
];
