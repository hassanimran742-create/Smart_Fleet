import type { TFunction } from 'i18next';
import type { DayEndStage, OrderFeeStatus, OrderStage, PaymentStage, RefillStage } from '@smartfleet/shared-types';
import type { IconName } from './Icon';
import type { Tone } from './tokens';

/**
 * Driver step chips (UX_MOBILE §3.4; UX_PRINCIPLES §4.2): a phone-side state derived from the stop
 * status. An order that FAILED is NOT_DELIVERED (red); a stop or order CANCELLED is CANCELLED (grey).
 */
export type DriverStepState = 'TO_DO' | 'NEXT' | 'IN_PROGRESS' | 'DONE' | 'NOT_DELIVERED' | 'CANCELLED';
/** Customer answer chip [Inc 2]: the four answers plus the two waiting states. */
export type AnswerChipState = 'YES' | 'PARTLY' | 'NO' | 'OTHER' | 'PENDING' | 'EXPIRED';
/** Refill stage (UX_MOBILE §8.1): the server's `RefillStage`, sent on every refill from Inc 1. */
export type RefillChipStage = RefillStage;
/** Day-end status [Inc 3] (UX_MOBILE §8.3): the server's `DayEndStage`. */
export type DayEndChipStatus = DayEndStage;

export interface StatusLook {
  tone: Tone;
  icon: IconName | null;
}

/** The value each chip kind takes. */
export interface StatusValues {
  order: OrderStage;
  fee: OrderFeeStatus;
  topup: PaymentStage;
  answer: AnswerChipState;
  refill: RefillChipStage;
  dayEnd: DayEndChipStatus;
  step: DriverStepState;
}
export type StatusKind = keyof StatusValues;

/** Template parameters a chip may need. */
export interface StatusParams {
  /** The fee chip's amount ("Rs 330 paid"). */
  fee?: string;
  /** The step's own icon for an IN_PROGRESS step (Load `van`, Deliver `customer`, Unload `store`). */
  icon?: IconName;
}

interface KindTable<V extends string> {
  looks: Record<V, StatusLook>;
  label: (value: V, t: TFunction, params: StatusParams) => string;
  /** Adjusts the look from the params (the step's icon). */
  look?: (value: V, look: StatusLook, params: StatusParams) => StatusLook;
}

/*
 * Five families, existing tones only (UX_PRINCIPLES §4.1): green done (`ok`), amber waiting (the
 * `checking` clock, and only for waiting), blue moving (the action's icon), red problem (`error`),
 * grey nothing to do (no icon).
 */

const ORDER: KindTable<OrderStage> = {
  looks: {
    NEEDS_DRIVER: { tone: 'warning', icon: 'checking' },
    DRIVER_ASSIGNED: { tone: 'brand', icon: 'customer' },
    LOADING: { tone: 'brand', icon: 'store' },
    ON_THE_WAY: { tone: 'brand', icon: 'truck' },
    DELIVERED: { tone: 'success', icon: 'ok' },
    NOT_DELIVERED: { tone: 'danger', icon: 'error' },
    CANCELLED: { tone: 'neutral', icon: null },
  },
  label: (value, t) => t(`stages.order.${value}`),
};

const FEE: KindTable<OrderFeeStatus> = {
  looks: {
    DEDUCTED: { tone: 'neutral', icon: null },
    REVERSED: { tone: 'success', icon: 'ok' },
    NONE: { tone: 'neutral', icon: null },
  },
  label: (value, t, params) => t(`stages.fee.${value}`, { fee: params.fee ?? '' }),
};

const TOPUP: KindTable<PaymentStage> = {
  looks: {
    BEING_CHECKED: { tone: 'warning', icon: 'checking' },
    ADDED: { tone: 'success', icon: 'ok' },
    NOT_ADDED: { tone: 'danger', icon: 'error' },
  },
  label: (value, t) => t(`stages.topup.${value}`),
};

/** The settled tones (G07-23, kept by the lead): Partly and Other amber, Not received red. */
const ANSWER: KindTable<AnswerChipState> = {
  looks: {
    YES: { tone: 'success', icon: 'ok' },
    PARTLY: { tone: 'warning', icon: 'warn' },
    NO: { tone: 'danger', icon: 'error' },
    OTHER: { tone: 'warning', icon: 'warn' },
    PENDING: { tone: 'warning', icon: 'checking' },
    EXPIRED: { tone: 'neutral', icon: null },
  },
  label: (value, t) => t(`stages.answer.${value}`),
};

const REFILL: KindTable<RefillChipStage> = {
  looks: {
    NEEDS_DRIVER: { tone: 'warning', icon: 'checking' },
    DRIVER_ASSIGNED: { tone: 'brand', icon: 'customer' },
    PICKING_UP: { tone: 'brand', icon: 'store' },
    PICKED_UP: { tone: 'brand', icon: 'truck' },
    AT_STATION: { tone: 'brand', icon: 'cylinder' },
    COMING_BACK: { tone: 'brand', icon: 'truck' },
    BACK_AT_STORE: { tone: 'brand', icon: 'store' },
    DONE: { tone: 'success', icon: 'ok' },
    CANCELLED: { tone: 'neutral', icon: null },
  },
  label: (value, t) => t(`stages.refill.${value}`),
};

const DAY_END: KindTable<DayEndChipStatus> = {
  looks: {
    NOT_STARTED: { tone: 'neutral', icon: null },
    READY: { tone: 'brand', icon: 'upload' },
    WAITING_FOR_APPROVAL: { tone: 'warning', icon: 'checking' },
    APPROVED: { tone: 'success', icon: 'ok' },
    SENT_BACK: { tone: 'danger', icon: 'error' },
  },
  label: (value, t) => t(`stages.dayEnd.${value}`),
};

const STEP: KindTable<DriverStepState> = {
  looks: {
    TO_DO: { tone: 'neutral', icon: null },
    NEXT: { tone: 'brand', icon: 'chevron' },
    // The step's own icon comes in `params.icon`; a trip on Today is a truck.
    IN_PROGRESS: { tone: 'brand', icon: 'truck' },
    DONE: { tone: 'success', icon: 'ok' },
    NOT_DELIVERED: { tone: 'danger', icon: 'error' },
    CANCELLED: { tone: 'neutral', icon: null },
  },
  label: (value, t) => t(`stages.step.${value}`),
  look: (value, look, params) => (value === 'IN_PROGRESS' && params.icon ? { ...look, icon: params.icon } : look),
};

const TABLES: { [K in StatusKind]: KindTable<StatusValues[K]> } = {
  order: ORDER,
  fee: FEE,
  topup: TOPUP,
  answer: ANSWER,
  refill: REFILL,
  dayEnd: DAY_END,
  step: STEP,
};

export interface ResolvedStatus extends StatusLook {
  label: string;
}

/**
 * Looks up the tone, icon and words of a status (UX_MOBILE §3.4). Returns null for a value the table
 * doesn't know, so the caller can show the neutral "Updating…" chip.
 */
export function resolveStatus<K extends StatusKind>(
  kind: K,
  value: string | null | undefined,
  t: TFunction,
  params: StatusParams = {},
): ResolvedStatus | null {
  const table = TABLES[kind] as unknown as KindTable<string>;
  if (!value || !Object.prototype.hasOwnProperty.call(table.looks, value)) return null;
  const base = table.looks[value];
  const look = table.look ? table.look(value, base, params) : base;
  return { ...look, label: table.label(value, t, params) };
}

/** True when `value` is a known status of `kind`. */
export function isKnownStatus<K extends StatusKind>(kind: K, value: unknown): value is StatusValues[K] {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TABLES[kind].looks, value);
}
