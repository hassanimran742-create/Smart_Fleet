import { useMemo, useState, type ReactNode } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { Phone, Store, Truck, UserRoundCheck } from 'lucide-react';
import type { AuditLogDto, OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { useCloseDrawer } from '../../app/drawer';
import { useNow } from '../../hooks/useNow';
import i18n from '../../i18n';
import { formatPhone, formatRs } from '../../i18n/format';
import {
  ActivityList,
  activityActor,
  Button,
  Drawer,
  ErrorState,
  FeeChip,
  Skeleton,
  SkeletonText,
  StaleBanner,
  StatusChip,
  Timeline,
  useFailedRefreshes,
  type TimelineItem,
} from '../../ui';
import { useOrder, useOrderHistory } from './api';
import { AssignDriverDialog } from './AssignDriverDialog';
import { CancelOrderDialog } from './CancelOrderDialog';
import { FailOrderDialog } from './FailOrderDialog';
import { costLine, driverText, FINISHED_STAGES, placedWhen, storeText } from './format';
import { ManualDeliveryDialog } from './ManualDeliveryDialog';
import { MoreMenu, type MoreMenuItem } from './MoreMenu';
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
 * · no refund", or "Could not deliver". Who assigned a driver comes from the order's audit rows.
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
  const finished = FINISHED_STAGES.includes(order.stage);
  const timeline = useMemo(() => orderTimeline(order, history), [order, history]);
  const driver = driverText(order);

  return (
    <>
      <Section title={t('drawer.sections.customer')}>
        <p className="sf-order__strong">{order.client.name}</p>
        <p className="sf-order__line">
          <Phone aria-hidden size={14} />
          <a href={`tel:${order.client.phone}`} aria-label={t('drawer.callCustomer', { name: order.client.name, phone: formatPhone(order.client.phone) })}>
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
        <p>{costLine(order)}</p>
        {!finished && order.cancel.noRefundReason === 'DELIVERY_STARTED' ? <p className="sf-order__warning">{t('drawer.noRefund')}</p> : null}
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
          <p className="sf-order__line">
            <Store aria-hidden size={16} />
            <span>{t('drawer.startsAt', { store: storeText(order.originStore) })}</span>
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

/**
 * The order drawer (`/orders/$orderId`, UX_ADMIN §2.5): customer, cylinders, the delivery cost as the
 * order stored it, driver and van with the start store, the timeline and the activity. Its buttons
 * follow the order's `allowedActions`, so the server decides what the office may do now.
 */
export function OrderDrawer() {
  const { t } = useTranslation(['orders', 'common']);
  const { orderId } = route.useParams();
  const close = useCloseDrawer();
  const now = useNow(60_000);
  const query = useOrder(orderId);
  const order = query.data;
  const history = useOrderHistory(orderId, order?.assignedAt ?? null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  // Data kept on screen while refreshes fail: say so after two failures (UX_ADMIN §1.9).
  const failedRefreshes = useFailedRefreshes(query);
  const stale = order !== undefined && failedRefreshes >= 2;

  const actions = order?.allowedActions ?? [];
  const startedFailOffered = actions.includes('MARK_FAILED');
  const moreItems: MoreMenuItem[] = [];
  if (order && actions.includes('CANCEL')) {
    moreItems.push({
      id: 'cancel',
      label: t('actions.cancel'),
      danger: true,
      description: !startedFailOffered && order.status !== 'PENDING' && order.status !== 'CONFIRMED' ? t('actions.cancelBeforeStart') : undefined,
      onSelect: () => setDialog('cancel'),
    });
  }
  if (startedFailOffered) moreItems.push({ id: 'fail', label: t('actions.fail'), onSelect: () => setDialog('fail') });
  if (actions.includes('MANUAL_DELIVERY')) {
    moreItems.push({ id: 'manual', label: t('actions.manualDelivery'), onSelect: () => setDialog('manual') });
  }

  const subtitle = order
    ? order.distributor
      ? t('drawer.subtitle', { distributor: order.distributor.businessName, when: placedWhen(order.createdAt, now) })
      : t('drawer.subtitleNoDistributor', { when: placedWhen(order.createdAt, now) })
    : undefined;

  return (
    <>
      <Drawer
        title={order ? t('drawer.title', { no: order.shortCode }) : t('drawer.titleLoading')}
        chip={order ? <StatusChip kind="order" value={order.stage} /> : null}
        subtitle={subtitle}
        width="lg"
        onClose={close}
        notice={stale ? <StaleBanner query={query} /> : undefined}
        footer={
          order
            ? {
                start: moreItems.length > 0 ? (
                  <MoreMenu
                    label={t('actions.more')}
                    ariaLabel={t('actions.moreLabel', { no: order.shortCode })}
                    items={moreItems}
                    placement="up"
                  />
                ) : undefined,
                end:
                  actions.includes('REASSIGN') || actions.includes('ASSIGN') ? (
                    <>
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
                  ) : undefined,
              }
            : undefined
        }
      >
        {query.isPending ? (
          <DrawerSkeleton />
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

      {order && dialog === 'assign' ? <AssignDriverDialog order={order} onClose={() => setDialog(null)} /> : null}
      {order && dialog === 'cancel' ? <CancelOrderDialog order={order} onClose={() => setDialog(null)} /> : null}
      {order && dialog === 'fail' ? <FailOrderDialog order={order} onClose={() => setDialog(null)} /> : null}
      {order && dialog === 'manual' ? <ManualDeliveryDialog order={order} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
