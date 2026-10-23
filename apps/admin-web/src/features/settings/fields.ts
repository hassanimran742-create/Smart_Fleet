import type { SettingKey } from '@smartfleet/shared-types';
import type { SettingsSection } from '../../app/search';
import type { ModuleId } from '../../app/modules';
import type { settings } from '../../i18n/en/settings';

/**
 * The Settings form (UX_ADMIN §2.8): a fixed list of rows by section, with no server-driven renderer.
 * `GET /settings` gives each row's value, bounds and who changed it; this file says how it is edited.
 */

/** Every leaf path of a nested copy object: `topup.minPaisa`, `dispatch.autoAssign.enabled`, … */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** A row description that exists in i18n/en/settings.ts (`tsc` checks each one). */
export type DescriptionKey = `descriptions.${Leaves<typeof settings.descriptions>}`;

export type FieldControl =
  /** A rupee amount (settings store paisa as whole numbers). `nullable`: empty means no limit. */
  | { kind: 'money'; nullable?: boolean; allowZero?: boolean }
  | { kind: 'integer' }
  | { kind: 'deliveryStartedAt' }
  | { kind: 'onAmountMismatch' }
  | { kind: 'switch'; module?: ModuleId }
  /** Free text; empty is "not set" (null). `phone` checks it can be dialled. */
  | { kind: 'text'; maxLength: number; phone?: boolean; placeholder: 'phone' | 'hours' }
  | { kind: 'version' }
  | { kind: 'hours' };

export interface FieldDef {
  key: SettingKey;
  section: SettingsSection;
  control: FieldControl;
  description?: DescriptionKey;
}

/** The editable rows, in page order. Read-only blocks (refill cost, company account) are drawn apart. */
export const FIELDS: readonly FieldDef[] = [
  // Money
  { key: 'topup.minPaisa', section: 'money', control: { kind: 'money' }, description: 'descriptions.topup.minPaisa' },
  { key: 'topup.maxPaisa', section: 'money', control: { kind: 'money' }, description: 'descriptions.topup.maxPaisa' },
  {
    key: 'topup.onAmountMismatch',
    section: 'money',
    control: { kind: 'onAmountMismatch' },
    description: 'descriptions.topup.onAmountMismatch',
  },
  { key: 'topup.maxPendingPerDistributor', section: 'money', control: { kind: 'integer' } },
  {
    key: 'wallet.maxBalancePaisa',
    section: 'money',
    control: { kind: 'money', nullable: true },
    description: 'descriptions.wallet.maxBalancePaisa',
  },
  {
    key: 'wallet.lowBalancePaisa',
    section: 'money',
    control: { kind: 'money', allowZero: true },
    description: 'descriptions.wallet.lowBalancePaisa',
  },
  // Orders and delivery
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
  { key: 'orders.maxCylindersPerOrder', section: 'orders', control: { kind: 'integer' } },
  { key: 'refill.maxCylinders', section: 'orders', control: { kind: 'integer' } },
  // Modules
  {
    key: 'features.transfers',
    section: 'modules',
    control: { kind: 'switch', module: 'transfers' },
    description: 'descriptions.features.transfers',
  },
  {
    key: 'features.fuelRefills',
    section: 'modules',
    control: { kind: 'switch', module: 'fuelRefills' },
    description: 'descriptions.features.fuelRefills',
  },
  {
    key: 'features.accessories',
    section: 'modules',
    control: { kind: 'switch', module: 'accessories' },
    description: 'descriptions.features.accessories',
  },
  {
    key: 'features.support',
    section: 'modules',
    control: { kind: 'switch', module: 'support' },
    description: 'descriptions.features.support',
  },
  {
    key: 'features.clientApp',
    section: 'modules',
    control: { kind: 'switch', module: 'clientApp' },
    description: 'descriptions.features.clientApp',
  },
  // Support
  {
    key: 'support.phone',
    section: 'support',
    control: { kind: 'text', maxLength: 24, phone: true, placeholder: 'phone' },
    description: 'descriptions.support.phone',
  },
  {
    key: 'support.whatsApp',
    section: 'support',
    control: { kind: 'text', maxLength: 24, phone: true, placeholder: 'phone' },
    description: 'descriptions.support.whatsApp',
  },
  {
    key: 'support.hours',
    section: 'support',
    control: { kind: 'text', maxLength: 60, placeholder: 'hours' },
    description: 'descriptions.support.hours',
  },
  { key: 'topup.checkingHours', section: 'support', control: { kind: 'hours' }, description: 'descriptions.topup.checkingHours' },
  // App versions
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
