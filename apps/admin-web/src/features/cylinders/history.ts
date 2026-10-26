import type { CylinderHistoryDto, CylinderStateValue } from '@smartfleet/shared-types';
import { localDate } from '@smartfleet/shared-utils';
import i18n from '../../i18n';
import { formatCalendarDate, formatDay, formatTime } from '../../i18n/format';

type HistoryEvent = CylinderHistoryDto['events'][number];

/**
 * The words of Find cylinder (UX_ADMIN §3.5): where a cylinder is now, and each move in plain words with
 * the website's four action words (Loaded · Delivered · Taken back · Unloaded). Never a code, a source
 * word or an id (STR-012).
 */

/** A place the server named, or a dash when it couldn't (the holder id isn't checked to exist). */
function place(label: string | null | undefined): string {
  return label && label.trim() ? label : i18n.t('cylinders:unknownPlace');
}

/** Empty · Part-filled · Full · Damaged · Lost. */
export function stateWord(state: CylinderStateValue): string {
  return i18n.t(`cylinders:state.${state}`);
}

/** The line of one move, before how it was recorded. */
function moveLine(event: HistoryEvent, earlier: readonly HistoryEvent[]): string {
  const t = i18n.t;
  switch (event.action) {
    case 'REGISTERED': {
      const store = place(event.to);
      const added = event.toState
        ? t('cylinders:history.REGISTERED_STATE', { store, state: stateWord(event.toState) })
        : t('cylinders:history.REGISTERED', { store });
      // A cylinder found on a day-end sheet and added by the office's approval.
      return event.dayEnd ? t('cylinders:history.fromDayEnd', { line: added }) : added;
    }
    case 'SCAN_OUT':
      return event.refill
        ? t('cylinders:history.SCAN_OUT_REFILL', { refill: event.refill.shortCode, plate: place(event.to) })
        : t('cylinders:history.SCAN_OUT', { plate: place(event.to), store: place(event.from) });
    case 'DELIVERED':
      return event.order
        ? t('cylinders:history.DELIVERED', { customer: place(event.to), order: event.order.shortCode })
        : t('cylinders:history.DELIVERED_NO_ORDER', { customer: place(event.to) });
    case 'PICKED_UP_EMPTY':
      return event.returnState
        ? t('cylinders:history.PICKED_UP_EMPTY', { customer: place(event.from), state: stateWord(event.returnState) })
        : t('cylinders:history.PICKED_UP_EMPTY_NO_STATE', { customer: place(event.from) });
    case 'FILLED': {
      const station = event.station?.name?.trim();
      if (event.refill) {
        return station
          ? t('cylinders:history.FILLED_AT', { station, refill: event.refill.shortCode })
          : t('cylinders:history.FILLED', { refill: event.refill.shortCode });
      }
      return station ? t('cylinders:history.FILLED_AT_NO_REFILL', { station }) : t('cylinders:history.FILLED_NO_REFILL');
    }
    case 'SCAN_IN': {
      const refill = event.refill;
      if (!refill) return t('cylinders:history.SCAN_IN', { store: place(event.to) });
      // A refill cylinder that was filled on the way comes back full.
      const filled = earlier.some((before) => before.action === 'FILLED' && before.refill?.shortCode === refill.shortCode);
      return filled
        ? t('cylinders:history.SCAN_IN_REFILL_FULL', { refill: refill.shortCode, store: place(event.to) })
        : t('cylinders:history.SCAN_IN_REFILL', { refill: refill.shortCode, store: place(event.to) });
    }
    case 'ADJUSTED':
      return event.dayEnd
        ? t('cylinders:history.ADJUSTED_DAY', { day: formatCalendarDate(event.dayEnd.businessDate), name: event.actor.name })
        : t('cylinders:history.ADJUSTED', { name: event.actor.name });
    default:
      // RETURNED_TO_DISTRIBUTOR, TRANSFER, MARK_FAULTY, MARK_LOST: moves from before the pilot's rules.
      return t('cylinders:history.OLDER');
  }
}

/** One history line: the move, plus " · number typed" or " · by the office: …" when that is how it was recorded. */
export function historyLine(event: HistoryEvent, earlier: readonly HistoryEvent[]): string {
  const line = moveLine(event, earlier);
  if (event.source === 'TYPED') return i18n.t('cylinders:history.typed', { line });
  if (event.source === 'MANUAL') {
    const reason = event.reason?.trim();
    return reason ? i18n.t('cylinders:history.manual', { line, reason }) : i18n.t('cylinders:history.manualNoReason', { line });
  }
  return line;
}

/** "10:58 am" for a moment today (Asia/Karachi), "Mon 19 Oct" before today. */
function sinceText(at: string, now: number): string {
  return localDate(at) === localDate(now) ? formatTime(at) : formatDay(at);
}

/**
 * Where the cylinder is now, said "with …", never "holder": "With Sana · AG-0142 · since 10:58 am",
 * "On van LEA-101 · since 9:40 am", "In Ahmed Gas Store · since Mon 19 Oct".
 */
export function holderLine(history: CylinderHistoryDto, now: number = Date.now()): string {
  const t = i18n.t;
  const { holder, events } = history;
  const name = place(holder.label);
  if (holder.type === 'CLIENT') {
    // The order that brought it to the customer: the newest delivery.
    const delivery = [...events].reverse().find((event) => event.action === 'DELIVERED');
    if (!holder.since) return t('cylinders:holder.CLIENT_NOW', { name });
    const since = sinceText(holder.since, now);
    return delivery?.order
      ? t('cylinders:holder.CLIENT_ORDER', { name, order: delivery.order.shortCode, since })
      : t('cylinders:holder.CLIENT', { name, since });
  }
  if (holder.type === 'VEHICLE') {
    return holder.since ? t('cylinders:holder.VEHICLE', { name, since: sinceText(holder.since, now) }) : t('cylinders:holder.VEHICLE_NOW', { name });
  }
  return holder.since ? t('cylinders:holder.STORE', { name, since: sinceText(holder.since, now) }) : t('cylinders:holder.STORE_NOW', { name });
}
