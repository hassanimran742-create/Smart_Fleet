import { useMemo, useState, type ReactNode } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Phone, SearchX, Store, Truck, UserRoundCheck } from 'lucide-react';
import type { AuditLogDto, OrderBoardDto, OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { toApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { useCloseDrawer } from '../../app/drawer';
import { useNow } from '../../hooks/useNow';
import i18n from '../../i18n';
import { formatPhone, formatRs } from '../../i18n/format';
import {
  ActivityList,
  activityActor,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  FeeChip,
  InlineAlert,
  KeyValueList,
  Skeleton,
  SkeletonText,
  StaleBanner,
  StatusChip,
  Timeline,
  useStaleness,
  type TimelineItem,
} from '../../ui';
import { useOrder, useOrderHistory } from './api';
import { AssignDriverDialog } from './AssignDriverDialog';
import { CancelOrderDialog } from './CancelOrderDialog';
import { FailOrderDialog } from './FailOrderDialog';
import { costBreakdown, drawerSubtitle, driverText, FINISHED_STAGES, outcomeReason } from './format';
import { ManualDeliveryDialog } from './ManualDeliveryDialog';
import './orders.css';

const route = getRouteApi('/orders/$orderId');

type DialogKind = 'assign' | 'cancel' | 'fail' | 'manual';

function scalar(diff: AuditLogDto['diff'], key: string): string | null {
  const value = diff?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * The order's timeline (UX_ADMIN §2.5): "Placed · Rs 330 taken from wallet", "Driver assigned (by
 * Sana)", "Loading started", "On the way", then "Delivered", "Cancelled · Rs 330 returned" / "Cancelled
 * · no refund", or "Not delivered", with the reason under a cancelled or not-delivered step. Who
 * assigned a driver comes from the order's audit rows.
 */
export function orderTimeline(order: OrderDto, history: readonly AuditLogDto[] | undefined): TimelineItem[] {
  const t = i18n.t;
  const charged = order.fee.status !== 'NONE' && order.fee.totalPaisa !== '0';
  const amount = formatRs(order.fee.totalPaisa);
  const items: TimelineItem[] = [
    {
      id: 'placed',
      title: charged ? t('orders:timeline.placedPaid', { amount }) : t('orders:timeline.placed'),
      at: order.createdAt,
    },
  ];

  const moves = (history ?? []).filter((row) => row.action === 'order.assign' || row.action === 'order.reassign');
  if (moves.length > 0) {
    for (const row of moves) {
      const name = activityActor(row);
      items.push({
        id: row.id,
        title:
          row.action === 'order.reassign'
            ? t('orders:timeline.changedBy', { driver: scalar(row.diff, 'to') ?? '', name })
            : t('orders:timeline.assignedBy', { name }),
        at: row.at,
        meta: row.action === 'order.assign' ? scalar(row.diff, 'driver') ?? undefined : undefined,
        tone: 'info',
      });
    }
  } else if (order.assignedAt) {
    items.push({ id: 'assigned', title: t('orders:timeline.assigned'), at: order.assignedAt, tone: 'info' });
  }

  if (order.loadStartedAt) items.push({ id: 'loading', title: t('orders:timeline.loading'), at: order.loadStartedAt, tone: 'info' });
  if (order.onTheWayAt) items.push({ id: 'on-the-way', title: t('orders:timeline.onTheWay'), at: order.onTheWayAt, tone: 'info' });
  if (order.deliveredAt) {
    items.push({
      id: 'delivered',
      title: order.deliveryMethod === 'MANUAL' ? t('orders:timeline.deliveredByOffice') : t('orders:timeline.delivered'),
      at: order.deliveredAt,
      tone: 'success',
    });
  }
  if (order.cancelledAt) {
    const title =
      order.fee.status === 'REVERSED'
        ? t('orders:timeline.cancelledReturned', { amount })
        : charged
          ? t('orders:timeline.cancelledNoRefund')
          : t('orders:timeline.cancelled');
    items.push({
      id: 'cancelled',
      title,
      at: order.cancelledAt,
      meta: order.cancelReasonCode
        ? t('orders:timeline.reason', { reason: t(`orders:cancel.reason.${order.cancelReasonCode}`) })
        : undefined,
      tone: 'neutral',
    });
  }
  if (order.failedAt) {
    items.push({
      id: 'failed',
      title: t('orders:timeline.failed'),
      at: order.failedAt,
      meta: order.failureReasonCode
        ? t('orders:timeline.reason', { reason: t(`orders:fail.reason.${order.failureReasonCode}`) })
        : undefined,
      tone: 'danger',
    });
  }

  // Oldest first; events at the same moment keep the order above.
  return items
    .map((item, index) => ({ item, index, at: item.at ? new Date(item.at).getTime() : 0 }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * The outcome line at the top of the drawer (website spec W28), only when it applies: a cancel that
 * would return nothing while the order is under way; what happened to the money on a cancelled order,
 * with its reason; and why a not-delivered order didn't arrive, with what happens next.
 */
function OutcomeLine({ order }: { order: OrderDto }) {
  const { t } = useTranslation('orders');
  const reason = outcomeReason(order);
  const charged = order.fee.totalPaisa !== '0' && order.fee.status !== 'NONE';
  if (!FINISHED_STAGES.includes(order.stage)) {
    return order.cancel.noRefundReason === 'DELIVERY_STARTED' ? <InlineAlert tone="warning">{t('drawer.noRefund')}</InlineAlert> : null;
  }
  if (order.stage === 'CANCELLED') {
    if (order.fee.status === 'REVERSED') {
      const amount = formatRs(order.fee.totalPaisa);
      return (
        <InlineAlert tone="neutral">
          {reason ? t('drawer.outcome.returned', { amount, reason }) : t('drawer.outcome.returnedNoReason', { amount })}
        </InlineAlert>
      );
    }
    if (charged) {
      return (
        <InlineAlert tone="neutral">
          {reason ? t('drawer.outcome.noRefund', { reason }) : t('drawer.outcome.noRefundNoReason')}
        </InlineAlert>
      );
    }
    return null;
  }
  if (order.stage === 'NOT_DELIVERED') {
    return (
      <InlineAlert tone="danger">
        {reason ? t('drawer.outcome.notDelivered', { reason }) : t('drawer.outcome.notDeliveredNoReason')}
      </InlineAlert>
    );
  }
  return null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sf-order__section" aria-label={title}>
      <h3 className="sf-order__section-title">{title}</h3>
      {children}
    </section>
  );
}

function OrderBody({ order, history }: { order: OrderDto; history: readonly AuditLogDto[] | undefined }) {
  const { t } = useTranslation('orders');
  const timeline = useMemo(() => orderTimeline(order, history), [order, history]);
  const driver = driverText(order);
  const cost = costBreakdown(order);

  return (
    <>
      <div className="sf-order__outcome">
        <OutcomeLine order={order} />
      </div>

      <Section title={t('drawer.sections.customer')}>
        <p className="sf-order__strong">{order.client.name}</p>
        <p className="sf-order__line">
          <Phone aria-hidden size={14} />
          <a
            href={`tel:${order.client.phone}`}
            aria-label={t('drawer.callCustomer', { name: order.client.name, phone: formatPhone(order.client.phone) })}
          >
            {formatPhone(order.client.phone)}
          </a>
        </p>
        <p>{order.deliveryAddressLabel}</p>
        <p className="sf-orders__muted">{t('drawer.customerZone', { zone: order.destZone.name })}</p>
      </Section>

      <Section title={t('drawer.sections.cylinders')}>
        <ul className="sf-order__lines">
          {order.lines.map((line) => (
            <li key={line.id} className="sf-order__line">
              <span className="sf-order__strong">{t('format.cylinderLine', { n: line.fullCount, size: line.sizeLabel })}</span>
              <span className="sf-orders__muted">
                {line.expectedReturnCount > 0 ? t('drawer.cylinderTakeBack', { n: line.expectedReturnCount }) : t('drawer.noTakeBack')}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('drawer.sections.cost')}>
        <div className="sf-order__line">
          <FeeChip amountPaisa={order.fee.totalPaisa} status={order.fee.status} />
        </div>
        {cost.kind === 'rows' ? (
          <KeyValueList compact className="sf-order__cost" items={cost.rows.map((row) => ({ id: row.id, label: row.label, value: row.value }))} />
        ) : (
          <p className="sf-orders__muted">{cost.kind === 'legacy' ? t('drawer.costLegacy') : t('drawer.costNone')}</p>
        )}
      </Section>

      <Section title={t('drawer.sections.driver')}>
        {driver && order.trip ? (
          <>
            <p className="sf-order__line">
              <Truck aria-hidden size={16} />
              <span className="sf-order__strong">{driver}</span>
            </p>
            <p className="sf-order__line">
              <Phone aria-hidden size={14} />
              <a
                href={`tel:${order.trip.driver.phone}`}
                aria-label={t('drawer.callDriver', { name: order.trip.driver.name, phone: formatPhone(order.trip.driver.phone) })}
              >
                {formatPhone(order.trip.driver.phone)}
              </a>
            </p>
          </>
        ) : (
          <p className="sf-orders__muted">{t('drawer.driverNone')}</p>
        )}
        {order.originStore ? (
          <p className="sf-order__line sf-orders__muted">
            <Store aria-hidden size={14} />
            <span>{t('drawer.startsAt', { store: order.originStore.name })}</span>
          </p>
        ) : null}
      </Section>

      <Section title={t('drawer.sections.timeline')}>
        <Timeline items={timeline} />
      </Section>

      <ActivityList resourceType="order" resourceId={order.id} />
    </>
  );
}

function DrawerSkeleton() {
  return (
    <div className="sf-order__skeleton" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="sf-order__section">
          <Skeleton width="30%" />
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}

/** The order's number from a board row already on screen, for the title while the drawer loads. */
function useCachedShortCode(orderId: string): string | null {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const pages = queryClient.getQueriesData<InfiniteData<OrderBoardDto>>({ queryKey: [...qk.orders.all, 'board'] });
    for (const [, data] of pages) {
      for (const page of data?.pages ?? []) {
        const row = page.items?.find((item) => item.id === orderId);
        if (row) return row.shortCode;
      }
    }
    return null;
  }, [queryClient, orderId]);
}

/**
 * The order drawer (`/orders/$orderId`, UX_ADMIN §2.5, website spec W28): the outcome line first, then
 * Customer, Cylinders, the delivery cost as rows, Driver (with the start store), the Timeline and the
 * collapsed Activity. The footer holds only what the order's `allowedActions` allow, so the server
 * decides: "Cancel order…" at the start, then "Mark delivered…", "Could not deliver…", "Change driver"
 * and the primary "Assign driver" (4 at most). After an assign the drawer closes, so the office goes on
 * to the next order; after a cancel, not delivered or mark delivered it stays open on the result.
 */
export function OrderDrawer() {
  const { t } = useTranslation(['orders', 'common']);
  const { orderId } = route.useParams();
  const close = useCloseDrawer();
  const now = useNow(60_000);
  const query = useOrder(orderId);
  const order = query.data;
  const cachedShortCode = useCachedShortCode(orderId);
  const history = useOrderHistory(orderId, order?.assignedAt ?? null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  // Data kept on screen while refreshes fail: say so, once (UX_ADMIN §1.11).
  const staleness = useStaleness(query);

  const actions = order?.allowedActions ?? [];
  const shortCode = order?.shortCode ?? cachedShortCode;

  const footerEnd = order ? (
    <>
      {actions.includes('MANUAL_DELIVERY') ? (
        <Button variant="ghost" onClick={() => setDialog('manual')}>
          {t('actions.manualDelivery')}
        </Button>
      ) : null}
      {actions.includes('MARK_FAILED') ? (
        <Button onClick={() => setDialog('fail')}>{t('actions.fail')}</Button>
      ) : null}
      {actions.includes('REASSIGN') ? (
        <Button icon={UserRoundCheck} onClick={() => setDialog('assign')}>
          {t('actions.reassign')}
        </Button>
      ) : null}
      {actions.includes('ASSIGN') ? (
        <Button variant="primary" icon={UserRoundCheck} onClick={() => setDialog('assign')}>
          {t('actions.assign')}
        </Button>
      ) : null}
    </>
  ) : null;
  const hasEnd = actions.some((action) => action === 'MANUAL_DELIVERY' || action === 'MARK_FAILED' || action === 'REASSIGN' || action === 'ASSIGN');

  return (
    <>
      <Drawer
        title={shortCode ? t('drawer.title', { no: shortCode }) : <Skeleton width={160} height="1.2em" />}
        chip={order ? <StatusChip kind="order" value={order.stage} /> : null}
        subtitle={order ? drawerSubtitle(order, now) : undefined}
        width="lg"
        onClose={close}
        notice={order && staleness.kind ? <StaleBanner query={query} /> : undefined}
        footer={
          order
            ? {
                start: actions.includes('CANCEL') ? (
                  <Button variant="ghost-danger" onClick={() => setDialog('cancel')}>
                    {t('actions.cancel')}
                  </Button>
                ) : undefined,
                end: hasEnd ? footerEnd : undefined,
              }
            : undefined
        }
      >
        {query.isPending ? (
          <DrawerSkeleton />
        ) : !order && toApiError(query.error).is('NOT_FOUND') ? (
          <EmptyState icon={SearchX} title={t('drawer.notFound')} />
        ) : !order ? (
          <ErrorState
            error={query.error}
            title={t('drawer.loadFailed')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : (
          <OrderBody order={order} history={history.data} />
        )}
      </Drawer>

      {order && dialog === 'assign' ? (
        <AssignDriverDialog order={order} onClose={() => setDialog(null)} onAssigned={close} />
      ) : null}
      {order && dialog === 'cancel' ? <CancelOrderDialog order={order} onClose={() => setDialog(null)} /> : null}
      {order && dialog === 'fail' ? <FailOrderDialog order={order} onClose={() => setDialog(null)} /> : null}
      {order && dialog === 'manual' ? <ManualDeliveryDialog order={order} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
