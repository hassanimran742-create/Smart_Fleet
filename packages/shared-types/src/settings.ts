import type { IdName, IsoDateTime, Paisa } from './common.types';
import type { ConfirmationResponse } from './confirmation.types';
import type { DeliveryStartedRule, FeeStrategy } from './order.types';
import type { CheckingHours, TopupAccount } from './payment.types';
import type { UserRoleValue } from './user.types';

/**
 * Every runtime setting (API_CONTRACT §6), mirrored from `apps/api/src/modules/settings/registry.ts`,
 * which holds each key's zod schema, default, `public`, `editable` and increment.
 * Inc 2 and Inc 3 keys are listed too: `GET /app/config` already reports their features.
 */
export const SETTING_KEYS = [
  'dispatch.autoAssign.enabled',
  'auth.otpLogin.enabled',
  'auth.lockedRoles',
  'features.transfers',
  'features.fuelRefills',
  'features.accessories',
  'features.support',
  'features.clientApp',
  'app.minVersion.driver',
  'app.minVersion.distributor',
  'orders.deliveryStartedAt',
  'orders.maxCylindersPerOrder',
  'pricing.deliveryStrategy',
  'wallet.maxBalancePaisa',
  'wallet.lowBalancePaisa',
  'topup.minPaisa',
  'topup.maxPaisa',
  'topup.quickAmountsPaisa',
  'topup.maxPendingPerDistributor',
  'topup.onAmountMismatch',
  'topup.checkingHours',
  'topup.account',
  'topup.secondApproval',
  'refill.maxCylinders',
  'refill.deliveryCost',
  'support.phone',
  'support.whatsApp',
  'support.hours',
  'day.timezone',
  'day.cutoffLocalTime',
  // Inc 2
  'confirmation.enabled',
  'confirmation.linkTtlHours',
  'confirmation.caseOnAnswers',
  'messaging.testMode',
  'messaging.allowlist',
  'custody.typedEntry.enabled',
  'custody.forgottenInPolicy',
  'trip.allowFinishWithLeftovers',
  'walkIn.counterSwap.enabled',
  // Inc 3
  'dayEnd.enabled',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Setting `topup.onAmountMismatch`: what approving does when the bank amount differs from the request (ADR-09). */
export const TOPUP_AMOUNT_MISMATCH_POLICIES = ['CREDIT_BANK_AMOUNT', 'REJECT'] as const;
export type TopupAmountMismatchPolicy = (typeof TOPUP_AMOUNT_MISMATCH_POLICIES)[number];

/** Setting `custody.forgottenInPolicy` (Inc 2): only this value is built. */
export type ForgottenInPolicy = 'BLOCK_OUT_MANUAL_DELIVERY';

/** Setting `topup.secondApproval`: reserved, not built. */
export interface TopupSecondApproval {
  enabled: boolean;
  thresholdPaisa: number;
}

/** Setting `refill.deliveryCost`: reserved and off (ADR-16). */
export interface RefillDeliveryCost {
  enabled: boolean;
  basePaisa: number;
  perCylinderPaisa: number;
}

/**
 * The stored value type of each setting. Settings are JSON values, so paisa amounts here are
 * integers (`number`); `GET /app/config` sends them as digit strings like every other response.
 */
export interface SettingValueMap {
  'dispatch.autoAssign.enabled': boolean;
  'auth.otpLogin.enabled': boolean;
  'auth.lockedRoles': UserRoleValue[];
  'features.transfers': boolean;
  'features.fuelRefills': boolean;
  'features.accessories': boolean;
  'features.support': boolean;
  'features.clientApp': boolean;
  /** Semver "x.y.z". */
  'app.minVersion.driver': string;
  /** Semver "x.y.z". */
  'app.minVersion.distributor': string;
  'orders.deliveryStartedAt': DeliveryStartedRule;
  /** 1–100. */
  'orders.maxCylindersPerOrder': number;
  'pricing.deliveryStrategy': Extract<FeeStrategy, 'DISTRIBUTOR_ZONE'>;
  /** Null means no cap. */
  'wallet.maxBalancePaisa': number | null;
  'wallet.lowBalancePaisa': number;
  'topup.minPaisa': number;
  'topup.maxPaisa': number;
  'topup.quickAmountsPaisa': number[];
  'topup.maxPendingPerDistributor': number;
  'topup.onAmountMismatch': TopupAmountMismatchPolicy;
  'topup.checkingHours': CheckingHours;
  /** Set only by the settings CLI; null until configured (`TOPUP_ACCOUNT_NOT_CONFIGURED`). */
  'topup.account': TopupAccount | null;
  'topup.secondApproval': TopupSecondApproval;
  /** 1–30. */
  'refill.maxCylinders': number;
  'refill.deliveryCost': RefillDeliveryCost;
  'support.phone': string | null;
  'support.whatsApp': string | null;
  'support.hours': string | null;
  /** An IANA time zone, "Asia/Karachi" by default. */
  'day.timezone': string;
  /** Local "HH:mm" at which the business day starts, "03:00" by default. */
  'day.cutoffLocalTime': string;
  'confirmation.enabled': boolean;
  /** 24–168. */
  'confirmation.linkTtlHours': number;
  'confirmation.caseOnAnswers': ConfirmationResponse[];
  'messaging.testMode': boolean;
  /** E.164 numbers that test mode may message. */
  'messaging.allowlist': string[];
  'custody.typedEntry.enabled': boolean;
  'custody.forgottenInPolicy': ForgottenInPolicy;
  'trip.allowFinishWithLeftovers': boolean;
  'walkIn.counterSwap.enabled': boolean;
  'dayEnd.enabled': boolean;
}

export type SettingValue<K extends SettingKey> = SettingValueMap[K];

type Assert<T extends true> = T;
// Compile-time guard: SETTING_KEYS and SettingValueMap name exactly the same keys.
type _SettingKeysMatch = Assert<
  [Exclude<SettingKey, keyof SettingValueMap>] extends [never]
    ? [Exclude<keyof SettingValueMap, SettingKey>] extends [never]
      ? true
      : false
    : false
>;

/** How `GET /settings` describes a value, so the office form can show the right control. */
export type SettingValueType =
  | 'boolean'
  | 'integer'
  | 'paisa'
  | 'string'
  | 'semver'
  | 'time'
  | 'enum'
  | 'enum[]'
  | 'json';

/** A row of `GET /settings` (office). `updatedBy` is null when the value is the default or was set by a job or CLI. */
export interface SettingRowDto<K extends SettingKey = SettingKey> {
  key: K;
  value: SettingValue<K>;
  default: SettingValue<K>;
  type: SettingValueType;
  options?: readonly string[];
  min?: number;
  max?: number;
  editable: boolean;
  public: boolean;
  updatedAt: IsoDateTime | null;
  updatedBy: IdName | null;
}

/** One row of `GET /settings`, narrowed by its key. */
export type AnySettingRow = { [K in SettingKey]: SettingRowDto<K> }[SettingKey];

/**
 * `APP_ENV`, a deploy-level value: `PublicAppConfig.environment`. `training` alone sets
 * `PublicAppConfig.training`; the apps' environment strips follow `environment` (API_CONTRACT §6).
 */
export const APP_ENVIRONMENTS = ['development', 'test', 'staging', 'training', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/** `GET /app/config` (public, so the update gate runs before sign-in). Money is sent as digit strings. */
export interface PublicAppConfig {
  environment: AppEnvironment;
  training: boolean;
  minVersion: { driver: string; distributor: string };
  support: { phone: string | null; whatsApp: string | null; hours: string | null };
  features: {
    autoAssign: boolean;
    transfers: boolean;
    fuelRefills: boolean;
    accessories: boolean;
    support: boolean;
    clientApp: boolean;
    refills: true;
    /** True from the Inc 2 release. */
    scanFlow: boolean;
    confirmations: boolean;
    dayEnd: boolean;
    typedCylinderNumber: boolean;
    languageSwitch: false;
  };
  topup: { minPaisa: Paisa; maxPaisa: Paisa; quickAmountsPaisa: Paisa[]; checkingHours: CheckingHours };
  wallet: { lowBalancePaisa: Paisa; capPaisa: Paisa | null };
  orders: { maxCylindersPerOrder: number; deliveryStartedAt: DeliveryStartedRule };
  refill: { maxCylinders: number };
  day: { timezone: string; cutoffLocalTime: string };
  links: { updateUrl: string | null };
}
