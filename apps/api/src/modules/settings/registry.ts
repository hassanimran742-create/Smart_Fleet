import { UserRole } from '@prisma/client';
import {
  ConfirmationResponse,
  DELIVERY_STARTED_RULES,
  SETTING_KEYS,
  TOPUP_AMOUNT_MISMATCH_POLICIES,
  type SettingKey,
  type SettingValue,
  type SettingValueType,
} from '@smartfleet/shared-types';
import { z } from 'zod';

/**
 * The increment this build ships. Keys of a later increment keep their defaults and can't be changed
 * over the API until that increment ships; `GET /app/config` reports their features as off.
 */
export const RELEASE_INCREMENT = 1;

/** One setting (API_CONTRACT §5.2, §6). The code holds the typed default; an `app_settings` row overrides it. */
export interface SettingDefinition<K extends SettingKey> {
  key: K;
  schema: z.ZodType<SettingValue<K>, z.ZodTypeDef, unknown>;
  default: SettingValue<K>;
  /** Exposed by `GET /app/config`. */
  public: boolean;
  /** Changeable with `PATCH /settings/:key`. False keys change only through the settings CLI. */
  editable: boolean;
  inc: 1 | 2 | 3;
  /** How the office form shows it (`GET /settings`). */
  type: SettingValueType;
  options?: readonly string[];
  min?: number;
  max?: number;
}

export type SettingsRegistry = { readonly [K in SettingKey]: SettingDefinition<K> };

const PAISA_PER_RUPEE = 100;

/** A whole-rupee paisa amount (settings store paisa as JSON integers) within bounds. */
function paisa(minPaisa: number, maxPaisa = Number.MAX_SAFE_INTEGER) {
  return z
    .number()
    .int()
    .min(minPaisa)
    .max(maxPaisa)
    .refine((value) => value % PAISA_PER_RUPEE === 0, 'AMOUNT_NOT_WHOLE_RUPEES');
}

const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const DIALABLE = /^\+?[0-9][0-9 ()-]{5,22}$/;

const localTime = z.string().regex(LOCAL_TIME);
const semver = z.string().regex(SEMVER);
const flag = z.boolean();

function intRange(min: number, max: number) {
  return z.number().int().min(min).max(max);
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function uniqueList<T extends z.ZodTypeAny>(item: T, max: number) {
  return z
    .array(item)
    .max(max)
    .refine((list) => new Set(list.map((v) => JSON.stringify(v))).size === list.length, 'DUPLICATE_ITEM');
}

/** Roles that `auth.lockedRoles` may lock: never SUPER_ADMIN, which would lock the office out. */
const LOCKABLE_ROLES = Object.values(UserRole).filter((role) => role !== UserRole.SUPER_ADMIN);
const CONFIRMATION_ANSWERS = Object.values(ConfirmationResponse);

const supportText = z.string().trim().min(1).max(60).nullable();
const dialable = z.string().trim().regex(DIALABLE).nullable();

function boolSetting<K extends SettingKey>(
  key: K,
  defaultValue: boolean,
  options: { public: boolean; editable: boolean; inc: 1 | 2 | 3 },
): SettingDefinition<K> {
  // K is a boolean key at every call site; TypeScript can't narrow SettingValue<K> for a generic K.
  const schema = flag as unknown as SettingDefinition<K>['schema'];
  return { key, schema, default: defaultValue as SettingValue<K>, type: 'boolean', ...options };
}

export const SETTINGS: SettingsRegistry = {
  'dispatch.autoAssign.enabled': boolSetting('dispatch.autoAssign.enabled', false, { public: true, editable: true, inc: 1 }),
  // Reserved: code sign-in isn't built in the pilot, so both OTP routes always answer 403 AUTH_OTP_DISABLED (G11-15).
  'auth.otpLogin.enabled': boolSetting('auth.otpLogin.enabled', false, { public: false, editable: false, inc: 1 }),
  'auth.lockedRoles': {
    key: 'auth.lockedRoles',
    schema: uniqueList(z.enum(LOCKABLE_ROLES as [UserRole, ...UserRole[]]), LOCKABLE_ROLES.length),
    default: [UserRole.ADMIN, UserRole.DISPATCHER, UserRole.STORE_KEEPER, UserRole.CLIENT],
    public: false,
    editable: true,
    inc: 1,
    type: 'enum[]',
    options: LOCKABLE_ROLES,
  },
  'features.transfers': boolSetting('features.transfers', false, { public: true, editable: true, inc: 1 }),
  'features.fuelRefills': boolSetting('features.fuelRefills', false, { public: true, editable: true, inc: 1 }),
  'features.accessories': boolSetting('features.accessories', false, { public: true, editable: true, inc: 1 }),
  'features.support': boolSetting('features.support', false, { public: true, editable: true, inc: 1 }),
  'features.clientApp': boolSetting('features.clientApp', false, { public: true, editable: true, inc: 1 }),
  'app.minVersion.driver': {
    key: 'app.minVersion.driver',
    schema: semver,
    default: '0.0.0',
    public: true,
    editable: true,
    inc: 1,
    type: 'semver',
  },
  'app.minVersion.distributor': {
    key: 'app.minVersion.distributor',
    schema: semver,
    default: '0.0.0',
    public: true,
    editable: true,
    inc: 1,
    type: 'semver',
  },
  'orders.deliveryStartedAt': {
    key: 'orders.deliveryStartedAt',
    schema: z.enum(DELIVERY_STARTED_RULES),
    default: 'FIRST_LOAD_SCAN',
    public: true,
    editable: true,
    inc: 1,
    type: 'enum',
    options: DELIVERY_STARTED_RULES,
  },
  'orders.maxCylindersPerOrder': {
    key: 'orders.maxCylindersPerOrder',
    schema: intRange(1, 100),
    default: 30,
    public: true,
    editable: true,
    inc: 1,
    type: 'integer',
    min: 1,
    max: 100,
  },
  'pricing.deliveryStrategy': {
    key: 'pricing.deliveryStrategy',
    schema: z.literal('DISTRIBUTOR_ZONE'),
    default: 'DISTRIBUTOR_ZONE',
    public: false,
    // Reserved: editable once a second strategy exists.
    editable: false,
    inc: 1,
    type: 'enum',
    options: ['DISTRIBUTOR_ZONE'],
  },
  'wallet.maxBalancePaisa': {
    key: 'wallet.maxBalancePaisa',
    schema: paisa(PAISA_PER_RUPEE).nullable(),
    default: null,
    public: true,
    editable: true,
    inc: 1,
    type: 'paisa',
    min: PAISA_PER_RUPEE,
  },
  'wallet.lowBalancePaisa': {
    key: 'wallet.lowBalancePaisa',
    schema: paisa(0),
    default: 100_000,
    public: true,
    editable: true,
    inc: 1,
    type: 'paisa',
    min: 0,
  },
  'topup.minPaisa': {
    key: 'topup.minPaisa',
    schema: paisa(PAISA_PER_RUPEE),
    default: 50_000,
    public: true,
    editable: true,
    inc: 1,
    type: 'paisa',
    min: PAISA_PER_RUPEE,
  },
  'topup.maxPaisa': {
    key: 'topup.maxPaisa',
    schema: paisa(PAISA_PER_RUPEE),
    default: 5_000_000,
    public: true,
    editable: true,
    inc: 1,
    type: 'paisa',
    min: PAISA_PER_RUPEE,
  },
  'topup.quickAmountsPaisa': {
    key: 'topup.quickAmountsPaisa',
    schema: uniqueList(paisa(PAISA_PER_RUPEE), 6),
    default: [200_000, 500_000, 1_000_000],
    public: true,
    editable: true,
    inc: 1,
    type: 'json',
  },
  'topup.maxPendingPerDistributor': {
    key: 'topup.maxPendingPerDistributor',
    schema: intRange(1, 20),
    default: 3,
    public: false,
    editable: true,
    inc: 1,
    type: 'integer',
    min: 1,
    max: 20,
  },
  'topup.onAmountMismatch': {
    key: 'topup.onAmountMismatch',
    schema: z.enum(TOPUP_AMOUNT_MISMATCH_POLICIES),
    default: 'CREDIT_BANK_AMOUNT',
    public: false,
    editable: true,
    inc: 1,
    type: 'enum',
    options: TOPUP_AMOUNT_MISMATCH_POLICIES,
  },
  'topup.checkingHours': {
    key: 'topup.checkingHours',
    schema: z
      .object({ from: localTime, to: localTime })
      .strict()
      .refine((hours) => hours.from !== hours.to, 'INVALID_VALUE'),
    default: { from: '09:00', to: '21:00' },
    public: true,
    editable: true,
    inc: 1,
    type: 'json',
  },
  'topup.account': {
    key: 'topup.account',
    schema: z
      .object({
        accountTitle: z.string().trim().min(2).max(100),
        bankName: z.string().trim().min(2).max(100),
        iban: z
          .string()
          .trim()
          .transform((iban) => iban.replace(/\s+/g, '').toUpperCase())
          .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/)),
        accountNumber: z.string().trim().min(4).max(40),
      })
      .strict()
      .nullable(),
    default: null,
    // Shown to distributors by GET /payments/topup-info, never by the anonymous /app/config.
    public: false,
    // Set only by the settings CLI, on the owner's written request (ADR-09).
    editable: false,
    inc: 1,
    type: 'json',
  },
  'topup.secondApproval': {
    key: 'topup.secondApproval',
    schema: z.object({ enabled: z.boolean(), thresholdPaisa: paisa(PAISA_PER_RUPEE) }).strict(),
    default: { enabled: false, thresholdPaisa: 2_000_000 },
    public: false,
    // Reserved, not built.
    editable: false,
    inc: 1,
    type: 'json',
  },
  'refill.maxCylinders': {
    key: 'refill.maxCylinders',
    schema: intRange(1, 30),
    default: 30,
    public: true,
    editable: true,
    inc: 1,
    type: 'integer',
    min: 1,
    max: 30,
  },
  'refill.deliveryCost': {
    key: 'refill.deliveryCost',
    schema: z.object({ enabled: z.boolean(), basePaisa: paisa(0), perCylinderPaisa: paisa(0) }).strict(),
    default: { enabled: false, basePaisa: 0, perCylinderPaisa: 0 },
    public: false,
    // Reserved and off (ADR-16).
    editable: false,
    inc: 1,
    type: 'json',
  },
  'support.phone': {
    key: 'support.phone',
    schema: dialable,
    default: null,
    public: true,
    editable: true,
    inc: 1,
    type: 'string',
  },
  'support.whatsApp': {
    key: 'support.whatsApp',
    schema: dialable,
    default: null,
    public: true,
    editable: true,
    inc: 1,
    type: 'string',
  },
  'support.hours': {
    key: 'support.hours',
    schema: supportText,
    default: '9am–9pm',
    public: true,
    editable: true,
    inc: 1,
    type: 'string',
  },
  'day.timezone': {
    key: 'day.timezone',
    schema: z.string().trim().min(1).max(64).refine(isTimeZone, 'INVALID_CHOICE'),
    default: 'Asia/Karachi',
    public: true,
    editable: true,
    inc: 1,
    type: 'string',
  },
  'day.cutoffLocalTime': {
    key: 'day.cutoffLocalTime',
    schema: localTime,
    default: '03:00',
    public: true,
    editable: true,
    inc: 1,
    type: 'time',
  },
  // ---- Inc 2 ----
  'confirmation.enabled': boolSetting('confirmation.enabled', false, { public: true, editable: true, inc: 2 }),
  'confirmation.linkTtlHours': {
    key: 'confirmation.linkTtlHours',
    schema: intRange(24, 168),
    default: 72,
    public: false,
    editable: true,
    inc: 2,
    type: 'integer',
    min: 24,
    max: 168,
  },
  'confirmation.caseOnAnswers': {
    key: 'confirmation.caseOnAnswers',
    schema: uniqueList(z.enum(CONFIRMATION_ANSWERS as [ConfirmationResponse, ...ConfirmationResponse[]]), 4),
    default: ['NO', 'OTHER'],
    public: false,
    editable: true,
    inc: 2,
    type: 'enum[]',
    options: CONFIRMATION_ANSWERS,
  },
  'messaging.testMode': boolSetting('messaging.testMode', true, { public: false, editable: true, inc: 2 }),
  'messaging.allowlist': {
    key: 'messaging.allowlist',
    schema: uniqueList(z.string().regex(E164), 50),
    default: [],
    public: false,
    editable: true,
    inc: 2,
    type: 'json',
  },
  'custody.typedEntry.enabled': boolSetting('custody.typedEntry.enabled', true, { public: true, editable: true, inc: 2 }),
  'custody.forgottenInPolicy': {
    key: 'custody.forgottenInPolicy',
    schema: z.literal('BLOCK_OUT_MANUAL_DELIVERY'),
    default: 'BLOCK_OUT_MANUAL_DELIVERY',
    public: false,
    // The only value built.
    editable: false,
    inc: 2,
    type: 'enum',
    options: ['BLOCK_OUT_MANUAL_DELIVERY'],
  },
  'trip.allowFinishWithLeftovers': boolSetting('trip.allowFinishWithLeftovers', false, {
    public: false,
    editable: true,
    inc: 2,
  }),
  // Not built.
  'walkIn.counterSwap.enabled': boolSetting('walkIn.counterSwap.enabled', false, { public: false, editable: false, inc: 2 }),
  // ---- Inc 3 ----
  'dayEnd.enabled': boolSetting('dayEnd.enabled', false, { public: true, editable: true, inc: 3 }),
};

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

export function settingDefinition<K extends SettingKey>(key: K): SettingDefinition<K> {
  return SETTINGS[key] as SettingDefinition<K>;
}

/** True when the key's increment has shipped in this build. */
export function isShipped(key: SettingKey): boolean {
  return SETTINGS[key].inc <= RELEASE_INCREMENT;
}

/** Whether `PATCH /settings/:key` may change it: editable, and its increment shipped. */
export function isEditableOverApi(key: SettingKey): boolean {
  return SETTINGS[key].editable && isShipped(key);
}
