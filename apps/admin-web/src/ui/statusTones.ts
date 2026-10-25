import {
  CalendarOff,
  Cylinder,
  Store,
  TriangleAlert,
  Truck,
  Upload,
  UserRoundCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { status } from '../i18n/en/status';

/** The colour family of a chip or a row edge. Never the only signal: a chip always has words and an icon. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** A `status` namespace kind: `order`, `fee`, `topup`, `distributor`… */
export type StatusKind = keyof typeof status;

/** The values of a kind, for example `StatusValue<'order'>` is `'NEEDS_DRIVER' | 'LOADING' | …`. */
export type StatusValue<K extends StatusKind> = keyof (typeof status)[K] & string;

/**
 * The tone of each status value (UX_PRINCIPLES §4: green done, amber waiting, blue moving, red a person
 * must look, grey nothing to do). A value missing here is neutral. Labels live in i18n/en/status.ts.
 */
export const STATUS_TONES: { readonly [K in StatusKind]: Partial<Record<StatusValue<K>, Tone>> } = {
  order: {
    NEEDS_DRIVER: 'warning',
    DRIVER_ASSIGNED: 'info',
    LOADING: 'info',
    ON_THE_WAY: 'info',
    DELIVERED: 'success',
    NOT_DELIVERED: 'danger',
    CANCELLED: 'neutral',
  },
  orderProgress: { LOADING: 'info' },
  orderStatus: {
    PENDING: 'warning',
    CONFIRMED: 'warning',
    ASSIGNED: 'info',
    IN_TRANSIT: 'info',
    DELIVERED: 'success',
    FAILED: 'danger',
    CANCELLED: 'neutral',
  },
  fee: { DEDUCTED: 'neutral', REVERSED: 'success', NONE: 'neutral' },
  topup: { BEING_CHECKED: 'warning', ADDED: 'success', NOT_ADDED: 'danger' },
  payment: { PENDING: 'warning', SUCCESS: 'success', REJECTED: 'danger', FAILED: 'danger', REFUNDED: 'neutral' },
  distributor: { PENDING: 'warning', ACTIVE: 'success', SUSPENDED: 'danger' },
  user: { PENDING: 'warning', ACTIVE: 'success', SUSPENDED: 'danger' },
  price: { SET: 'success', NOT_SET: 'danger', OUTSIDE: 'danger' },
  expense: { ACTIVE: 'neutral', VOIDED: 'neutral' },
  expenseType: { ACTIVE: 'success', ARCHIVED: 'neutral' },
  refillStage: {
    NEEDS_DRIVER: 'warning',
    DRIVER_ASSIGNED: 'info',
    PICKING_UP: 'info',
    PICKED_UP: 'info',
    AT_STATION: 'info',
    COMING_BACK: 'info',
    BACK_AT_STORE: 'info',
    DONE: 'success',
    CANCELLED: 'neutral',
  },
  refill: {
    PENDING: 'warning',
    ASSIGNED: 'info',
    EMPTIES_PICKED: 'info',
    AT_STATION: 'info',
    FILLED: 'info',
    RETURNED: 'info',
    COMPLETED: 'success',
    CANCELLED: 'neutral',
    FAILED: 'danger',
  },
  trip: { PLANNED: 'neutral', IN_PROGRESS: 'info', COMPLETED: 'success', ABORTED: 'neutral' },
  stop: { PENDING: 'neutral', ARRIVED: 'info', DONE: 'success', FAILED: 'danger', CANCELLED: 'neutral' },
  vehicle: { ACTIVE: 'success', MAINTENANCE: 'warning', RETIRED: 'neutral' },
  driver: { AVAILABLE: 'success', ON_LEAVE: 'warning', OFF_DUTY: 'neutral' },
  presence: { ONLINE: 'success', OFFLINE: 'neutral' },
  // [Inc 2] A taken-back part-filled cylinder is a plain fact, like an empty one.
  cylinder: { FULL: 'success', EMPTY: 'neutral', PART_FILLED: 'neutral', FAULTY: 'warning', LOST: 'danger' },
  alert: { OPEN: 'danger', ACKNOWLEDGED: 'warning', RESOLVED: 'success' },
  severity: { INFO: 'info', WARNING: 'warning', CRITICAL: 'danger' },
  transfer: { REQUESTED: 'warning', IN_TRANSIT: 'info', COMPLETED: 'success', CANCELLED: 'neutral' },
  module: { ON: 'success', OFF: 'neutral' },
  /** [Inc 2] The customer's answer (settled point G07-23, kept by the lead on 2026-10-23). */
  answer: { YES: 'success', PARTLY: 'warning', NO: 'danger', OTHER: 'warning', PENDING: 'warning', EXPIRED: 'neutral', CANCELLED: 'neutral' },
  /** [Inc 3] A day-end's stage (UX_ADMIN §4.3). */
  dayEnd: { NOT_STARTED: 'neutral', READY: 'info', SENT_BACK: 'danger', WAITING_FOR_APPROVAL: 'warning', APPROVED: 'success' },
  /** [Inc 3] A refill's stage with its count (UX_ADMIN §4.1): the tones of `refillStage`. */
  refillProgress: {
    PICKING_UP: 'info',
    PICKED_UP: 'info',
    COMING_BACK: 'info',
    BACK_AT_STORE: 'info',
    DONE: 'success',
  },
};

/**
 * Icons that replace the tone's icon (UX_ADMIN §1.10, UX_PRINCIPLES §4.1). A blue (moving) chip shows
 * the action's icon, as the phone does, so "Driver assigned" and "On the way" no longer look alike:
 * UserRoundCheck (a driver took it), Store (at the store: loading, picking up, back), Truck (on the
 * road), Cylinder (at the refill station). The clock means waiting and nothing else, so amber states
 * that aren't waiting get their own icon. Every other value keeps its tone's icon.
 */
export const STATUS_ICONS: { readonly [K in StatusKind]?: Partial<Record<StatusValue<K>, LucideIcon>> } = {
  order: { DRIVER_ASSIGNED: UserRoundCheck, LOADING: Store, ON_THE_WAY: Truck },
  orderProgress: { LOADING: Store },
  orderStatus: { ASSIGNED: UserRoundCheck, IN_TRANSIT: Truck },
  refillStage: {
    DRIVER_ASSIGNED: UserRoundCheck,
    PICKING_UP: Store,
    PICKED_UP: Truck,
    AT_STATION: Cylinder,
    COMING_BACK: Truck,
    BACK_AT_STORE: Store,
  },
  refill: { ASSIGNED: UserRoundCheck, EMPTIES_PICKED: Truck, AT_STATION: Cylinder, FILLED: Truck, RETURNED: Store },
  trip: { IN_PROGRESS: Truck },
  transfer: { IN_TRANSIT: Truck },
  vehicle: { MAINTENANCE: Wrench },
  driver: { ON_LEAVE: CalendarOff },
  cylinder: { FAULTY: TriangleAlert },
  severity: { WARNING: TriangleAlert },
  // Amber that isn't waiting takes the warning icon, never the clock (UX_PRINCIPLES §4.1).
  answer: { PARTLY: TriangleAlert, OTHER: TriangleAlert },
  dayEnd: { READY: Upload },
  refillProgress: { PICKING_UP: Store, PICKED_UP: Truck, COMING_BACK: Truck, BACK_AT_STORE: Store },
};

export function toneOf<K extends StatusKind>(kind: K, value: string): Tone {
  const tones = STATUS_TONES[kind] as Partial<Record<string, Tone>>;
  return tones[value] ?? 'neutral';
}

/** The icon a value shows instead of its tone's icon, or undefined to keep the tone's icon. */
export function iconOf<K extends StatusKind>(kind: K, value: string): LucideIcon | undefined {
  const icons = STATUS_ICONS[kind] as Partial<Record<string, LucideIcon>> | undefined;
  return icons?.[value];
}
