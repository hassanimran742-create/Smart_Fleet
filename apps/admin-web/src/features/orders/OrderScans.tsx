import type { ConfirmationView, OrderDto, ReturnState, StopProgress, TripDetailDto } from '@smartfleet/shared-types';
import { formatNo } from '@smartfleet/shared-utils';
import { useTranslation } from 'react-i18next';
import { KeyValueList } from '../../ui';
import { whenText } from './format';
import { MANUAL_RETURN_STATES, orderDistributorCode } from './manual';

type DeliveryProgress = Extract<StopProgress, { type: 'DELIVERY' }>;
type PickupProgress = Extract<StopProgress, { type: 'STORE_PICKUP' }>;

/** The trip's load progress (its store stop) and this order's visit progress (its delivery stop). */
function progressOf(trip: TripDetailDto | undefined, orderId: string): { pickup: PickupProgress | null; visit: DeliveryProgress | null } {
  let pickup: PickupProgress | null = null;
  let visit: DeliveryProgress | null = null;
  for (const stop of trip?.stops ?? []) {
    const progress = stop.progress;
    if (progress?.type === 'STORE_PICKUP') pickup = progress;
    else if (progress?.type === 'DELIVERY' && stop.orderId === orderId) visit = progress;
  }
  return { pickup, visit };
}

/** One state's taken-back lines: each labelled cylinder by number, then the unlabelled counts. */
interface TakenBackGroup {
  state: ReturnState;
  lines: string[];
}

export interface OrderScansProps {
  order: OrderDto;
  trip: TripDetailDto | undefined;
  /** The customer's confirmation view: what was taken back, when the trip can't be read. */
  answer: ConfirmationView | undefined;
}

/**
 * The Cylinders section's Inc 2 lines (UX_ADMIN §3.2, Inc 2/3 spec §3.2), from the scans: "Loaded 3 of 5
 * · 10:40 am · Kashif" while the van loads or is on the way (the trip's progress); "Delivered" with one
 * row per cylinder ("AG-C0001 · 11.8 kg", the order's own visit list); and "Taken back" grouped Empty,
 * Part-filled and Full, each labelled cylinder by number and "No label · 1 × 11.8 kg" in its state's
 * group, with "2 expected". Without the visit list, the trip's progress (per size) or the customer
 * link's record stands in. Read only: the scans are the record (ADR-13).
 */
export function OrderScans({ order, trip, answer }: OrderScansProps) {
  const { t } = useTranslation('orders');
  const { pickup, visit } = progressOf(trip, order.id);
  const code = orderDistributorCode(order);
  const expected = order.lines.reduce((sum, line) => sum + line.expectedReturnCount, 0);
  const moving = order.stage === 'LOADING' || order.stage === 'ON_THE_WAY';

  const loaded =
    moving && pickup && order.loadStartedAt && order.trip
      ? t('scans.loaded', {
          done: pickup.doneCount,
          total: pickup.neededCount,
          time: whenText(order.loadStartedAt),
          driver: order.trip.driver.name,
        })
      : null;

  // Delivered: one row per cylinder from the order's own visit list (`OrderDto.visit`); without it,
  // one line per size from the trip's progress.
  const numbered = order.visit?.given ?? [];
  const delivered =
    numbered.length > 0
      ? numbered.map((cylinder) => t('scans.deliveredItem', { no: cylinder.shortCode, size: cylinder.sizeLabel }))
      : visit && visit.give.doneCount > 0
        ? visit.give.lines
            .filter((line) => line.done > 0)
            .map((line) =>
              line.done >= line.needed
                ? t('scans.deliveredLine', { count: line.done, size: line.sizeLabel })
                : t('scans.deliveredShort', { size: line.sizeLabel, done: line.done, total: line.needed }),
            )
        : [];

  let groups: TakenBackGroup[] = [];
  const own = order.visit;
  if (own && (own.takenBack.length > 0 || own.unlabelled.length > 0)) {
    groups = MANUAL_RETURN_STATES.map((state) => ({
      state,
      lines: [
        ...own.takenBack
          .filter((item) => item.state === state)
          .map((item) => t('scans.takenBackItem', { no: item.shortCode, size: item.sizeLabel })),
        ...own.unlabelled
          .filter((item) => item.state === state && item.count > 0)
          .map((item) => t('scans.noLabel', { count: item.count, size: item.sizeLabel })),
      ],
    }));
  } else if (visit) {
    groups = MANUAL_RETURN_STATES.map((state) => ({
      state,
      lines: [
        ...visit.takeBack.items
          .filter((item) => item.state === state)
          .map((item) =>
            t('scans.takenBackItem', {
              no: item.shortNo !== null ? formatNo(code, 'CYLINDER', item.shortNo) : item.code,
              size: item.sizeLabel,
            }),
          ),
        ...visit.takeBack.unlabelled
          .filter((item) => item.state === state && item.count > 0)
          .map((item) => t('scans.noLabel', { count: item.count, size: item.sizeLabel })),
      ],
    }));
  } else if (answer && order.stage === 'DELIVERED') {
    // The trip couldn't be read: the confirmation's record of the visit says what came back.
    groups = MANUAL_RETURN_STATES.map((state) => ({
      state,
      lines: answer.takenBack
        .filter((item) => item.state === state)
        .map((item) =>
          item.unlabelled
            ? t('scans.noLabel', { count: item.count, size: item.size })
            : t('scans.takenBackLine', { count: item.count, size: item.size }),
        ),
    }));
  }
  groups = groups.filter((group) => group.lines.length > 0);
  const showTakenBack = groups.length > 0 || (expected > 0 && Boolean(visit ?? own));

  if (!loaded && delivered.length === 0 && !showTakenBack) return null;

  return (
    <div className="sf-order__scans">
      {loaded ? <p className="sf-orders__muted">{loaded}</p> : null}
      {delivered.length > 0 ? (
        <p className="sf-order__line">
          <span className="sf-order__strong">{t('scans.delivered')}</span>
          {numbered.length > 0 ? (
            <span className="sf-order__lines-stack">
              {delivered.map((line, index) => (
                <span key={index}>{line}</span>
              ))}
            </span>
          ) : (
            <span>{delivered.join(', ')}</span>
          )}
        </p>
      ) : null}
      {showTakenBack ? (
        <div className="sf-order__taken-back">
          <p className="sf-order__line">
            <span className="sf-order__strong">{t('scans.takenBack')}</span>
            {expected > 0 ? <span className="sf-orders__muted">{t('scans.expected', { count: expected })}</span> : null}
          </p>
          {groups.length > 0 ? (
            <KeyValueList
              compact
              items={groups.map((group) => ({
                id: group.state,
                label: t(`manual.state.${group.state}`),
                value: (
                  <span className="sf-order__lines-stack">
                    {group.lines.map((line, index) => (
                      <span key={index}>{line}</span>
                    ))}
                  </span>
                ),
              }))}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
