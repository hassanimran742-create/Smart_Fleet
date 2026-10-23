import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Linking, StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_CANCEL_REASONS, type OrderCancelTerms, type OrderDto } from '@smartfleet/shared-types';
import { formatRs } from '@smartfleet/shared-utils';
import { useIdempotencyKey } from '../../api/client';
import { isApiError, toApiError, type ApiError } from '../../api/errors';
import { invalidate, POLL_MS, qk } from '../../api/keys';
import { telUrl } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { formatWhenText } from '../../i18n';
import {
  Button,
  Card,
  colors,
  ConfirmSheet,
  EmptyState,
  Icon,
  QueryBoundary,
  radius,
  Screen,
  SkeletonCard,
  space,
  StatusChip,
  Text,
  Timeline,
  useToast,
  type TimelineItem,
} from '../../ui';
import { cancelOrder, fetchOrder, fetchOrderTracking, type OrderTrackingDto } from './shared/api';
import { costBreakdownText, isPositivePaisa, orderCost, paisaOrZero, phoneText } from './shared/format';
import { shopKeys } from './shared/keys';
import { useShopNavigation, useShopRoute } from './shared/navigation';
import { Notice } from './shared/Notice';
import { usePullRefresh } from './shared/refresh';

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT']);
const TRACKING_DELTA = 0.03;

/**
 * S11 Order detail (replaces TrackOrderScreen; the live socket is gone): the timeline with the cost
 * events, the cost card, the cylinders, the driver once assigned and their last position while on the
 * way. "Cancel order" opens a sheet whose words come from the order's own `cancel` terms; it sends the
 * refund the person saw, so a cancel after delivery started can never refund by surprise.
 */
export function OrderDetailScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const { params } = useShopRoute<'OrderDetail'>();
  const orderId = params.orderId;

  const onTheWayPoll = useFocusedInterval(POLL_MS.orderOnTheWay);
  const activePoll = useFocusedInterval(POLL_MS.ordersList);
  const order = useQuery<OrderDto, ApiError>({
    queryKey: qk.orders.byId(orderId),
    queryFn: () => fetchOrder(orderId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || !ACTIVE_STATUSES.has(data.status)) return false;
      return data.stage === 'ON_THE_WAY' ? onTheWayPoll : activePoll;
    },
  });
  const pull = usePullRefresh(order.refetch);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: order.data ? t('orders.detail.title', { code: order.data.shortCode }) : t('orders.detail.titleLoading'),
    });
  }, [navigation, order.data, t]);

  const notFound = !order.data && isApiError(order.error) && order.error.status === 404;
  const canCancel = !!order.data?.cancel.allowed;

  return (
    <Screen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        canCancel ? (
          <Button label={t('orders.detail.cancel')} onPress={() => setSheetOpen(true)} variant="danger" size="lg" />
        ) : undefined
      }
    >
      {notFound ? (
        <EmptyState icon="order" title={t('orders.detail.notFound')} />
      ) : (
        <QueryBoundary query={order} skeleton={<SkeletonCard lines={5} />}>
          {(data) => <OrderBody order={data} />}
        </QueryBoundary>
      )}
      {/* Outside the boundary (like the driver's sheets), so nothing the boundary shows can reset the
          reason, the note or the spinner of an open sheet. */}
      {order.data ? (
        <CancelSheet
          order={order.data}
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onRefetch={() => void order.refetch()}
        />
      ) : null}
    </Screen>
  );
}

function OrderBody({ order }: { order: OrderDto }) {
  const { t } = useTranslation();
  const cost = orderCost(order);
  // NONE is a zero cost or an order from before the switch-over: no cost was taken by this app.
  const charged = order.fee.status !== 'NONE' && isPositivePaisa(order.fee.totalPaisa);

  return (
    <View style={styles.stack}>
      <StatusChip kind="order" value={order.stage} />

      {order.stage === 'NEEDS_DRIVER' ? <Notice tone="brand" icon="checking" text={t('orders.new.officeAssigns')} /> : null}

      <Card>
        <Timeline items={timelineOf(order, t)} />
      </Card>

      <Card>
        <Text variant="label" tone="secondary">
          {t('orders.detail.costTitle')}
        </Text>
        <Text variant="heading" style={styles.cardLine}>
          {charged ? t('orders.detail.cost', { fee: formatRs(order.fee.totalPaisa) }) : t('orders.detail.costNone')}
        </Text>
        <View style={styles.chips}>
          <StatusChip kind="fee" value={order.fee.status} amountPaisa={order.fee.totalPaisa} />
        </View>
        {charged && cost ? <Text style={styles.cardLine}>{costBreakdownText(cost, t)}</Text> : null}
        {charged ? (
          <Text tone="secondary" style={styles.cardLine}>
            {t(`stages.feeLong.${order.fee.status}`)}
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text variant="label" tone="secondary">
          {t('orders.detail.itemsTitle')}
        </Text>
        <View style={styles.cardLines}>
          {order.lines.map((line) => (
            <Text key={line.id}>
              {t('orders.detail.itemLine', { count: line.fullCount, size: line.sizeLabel, back: line.expectedReturnCount })}
            </Text>
          ))}
        </View>
      </Card>

      <Card>
        <Text variant="label" tone="secondary">
          {t('orders.detail.customerTitle')}
        </Text>
        <Text variant="bodyStrong" style={styles.cardLine}>
          {t('orders.new.customerValue', { name: order.client.name, phone: phoneText(order.client.phone) })}
        </Text>
        <Text variant="label" tone="secondary" style={styles.cardGap}>
          {t('orders.detail.deliverTo')}
        </Text>
        <Text style={styles.cardLine}>
          {t('orders.new.deliverToValue', { label: order.deliveryAddressLabel, zone: order.destZone.name })}
        </Text>
      </Card>

      {order.trip ? <DriverCard order={order} /> : null}
      {order.stage === 'ON_THE_WAY' ? <TrackingCard order={order} /> : null}
    </View>
  );
}

/**
 * Placed · {{fee}} paid → Driver assigned → Loading at your store → On the way → Delivered, each with
 * its time; a cancelled order ends "Cancelled · {{fee}} returned" or "Cancelled · no refund".
 */
function timelineOf(order: OrderDto, t: TFunction): TimelineItem[] {
  const fee = formatRs(order.fee.totalPaisa);
  const paid = order.fee.status !== 'NONE' && isPositivePaisa(order.fee.totalPaisa);
  const when = (at: string | null) => (at ? formatWhenText(at) : undefined);
  const items: TimelineItem[] = [
    {
      key: 'placed',
      label: paid ? t('orders.detail.timeline.placed', { fee }) : t('orders.detail.timeline.placedFree'),
      time: when(order.createdAt),
      state: 'done',
    },
  ];

  const steps = [
    { key: 'assigned', label: t('orders.detail.timeline.assigned'), at: order.assignedAt },
    { key: 'loading', label: t('orders.detail.timeline.loading'), at: order.loadStartedAt },
    { key: 'onTheWay', label: t('orders.detail.timeline.onTheWay'), at: order.onTheWayAt },
    { key: 'delivered', label: t('orders.detail.timeline.delivered'), at: order.deliveredAt },
  ];
  // The furthest step the order has reached (a later step implies the earlier ones).
  const reachedIndex = (() => {
    if (order.status === 'DELIVERED') return steps.length - 1;
    const stageIndex: Record<string, number> = { DRIVER_ASSIGNED: 0, LOADING: 1, ON_THE_WAY: 2 };
    const fromTimes = steps.reduce((last, step, index) => (step.at ? index : last), -1);
    return Math.max(fromTimes, stageIndex[order.stage] ?? -1);
  })();

  if (order.status === 'CANCELLED' || order.status === 'FAILED') {
    steps.forEach((step, index) => {
      if (index <= reachedIndex && step.key !== 'delivered') {
        items.push({ key: step.key, label: step.label, time: when(step.at), state: 'done' });
      }
    });
    if (order.status === 'CANCELLED') {
      const returned = order.fee.status === 'REVERSED';
      items.push({
        key: 'cancelled',
        label: returned
          ? t('orders.detail.timeline.cancelledReturned', { fee })
          : paid
            ? t('orders.detail.timeline.cancelledNoRefund')
            : t('orders.detail.timeline.cancelled'),
        time: when(order.cancelledAt),
        state: paid && !returned ? 'problem' : 'done',
      });
    } else {
      items.push({
        key: 'failed',
        label: t('orders.detail.timeline.notDelivered'),
        time: when(order.failedAt),
        detail: order.failureReasonCode ? t(`orders.detail.failureReason.${order.failureReasonCode}`) : undefined,
        state: 'problem',
      });
    }
    return items;
  }

  const delivered = order.status === 'DELIVERED';
  steps.forEach((step, index) => {
    items.push({
      key: step.key,
      label: step.label,
      time: when(step.at),
      state: delivered || index < reachedIndex ? 'done' : index === reachedIndex ? 'current' : 'todo',
    });
  });
  return items;
}

/** The driver once assigned: name, van and "Call driver". */
function DriverCard({ order }: { order: OrderDto }) {
  const { t } = useTranslation();
  const trip = order.trip!;
  return (
    <Card>
      <Text variant="label" tone="secondary">
        {t('orders.detail.driverTitle')}
      </Text>
      <View style={styles.driverRow}>
        <View style={styles.avatar}>
          <Icon name="truck" size={24} tone="brand" />
        </View>
        <View style={styles.flex}>
          <Text variant="bodyStrong">{trip.driver.name}</Text>
          {trip.vehicle?.plateNo ? <Text tone="secondary">{t('orders.detail.van', { plate: trip.vehicle.plateNo })}</Text> : null}
        </View>
      </View>
      {trip.driver.phone ? (
        <Button
          label={t('orders.detail.callDriver')}
          onPress={() => void Linking.openURL(telUrl(trip.driver.phone)).catch(() => undefined)}
          icon="call"
          variant="secondary"
          style={styles.cardGap}
        />
      ) : null}
    </Card>
  );
}

/** While on the way: the driver's last position, polled every 20 seconds (`/orders/:id/tracking`). */
function TrackingCard({ order }: { order: OrderDto }) {
  const { t } = useTranslation();
  const poll = useFocusedInterval(POLL_MS.orderOnTheWay);
  const tracking = useQuery<OrderTrackingDto, ApiError>({
    queryKey: shopKeys.tracking(order.id),
    queryFn: () => fetchOrderTracking(order.id),
    refetchInterval: poll,
  });
  const driver = tracking.data?.driverLocation ?? null;
  const destination = tracking.data?.destination ?? order.destination;
  const center = driver ?? destination;

  return (
    <Card>
      <Text variant="label" tone="secondary">
        {t('orders.detail.trackingTitle')}
      </Text>
      {driver ? (
        <View style={styles.map} accessible accessibilityLabel={t('orders.detail.trackingMapA11y')}>
          <MapView
            style={StyleSheet.absoluteFill}
            region={{
              latitude: center.lat,
              longitude: center.lng,
              latitudeDelta: TRACKING_DELTA,
              longitudeDelta: TRACKING_DELTA,
            }}
            toolbarEnabled={false}
          >
            <Marker
              coordinate={{ latitude: destination.lat, longitude: destination.lng }}
              title={t('orders.detail.deliveryPin')}
              pinColor={colors.success}
            />
            <Marker
              coordinate={{ latitude: driver.lat, longitude: driver.lng }}
              title={t('orders.detail.driverPin')}
              pinColor={colors.brand}
            />
          </MapView>
        </View>
      ) : (
        <Text tone="secondary" style={styles.cardLine}>
          {t('orders.detail.trackingWaiting')}
        </Text>
      )}
    </Card>
  );
}

/**
 * The cancel sheet (UX_MOBILE S11). Its title, body and button follow the terms: a refund ("Yes, cancel
 * and get Rs 330 back"), no refund once delivery started (danger "Cancel without refund"), or nothing
 * to return ("Yes, cancel order"). `ORDER_CANCEL_TERMS_CHANGED` re-renders it with the new terms.
 */
function CancelSheet({
  order,
  visible,
  onClose,
  onRefetch,
}: {
  order: OrderDto;
  visible: boolean;
  onClose: () => void;
  onRefetch: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [override, setOverride] = useState<OrderCancelTerms | null>(null);
  // One key per opening of the sheet: a retry after a lost signal is the same cancel.
  const idem = useIdempotencyKey([order.id, visible]);
  const terms = override ?? order.cancel;
  const code = order.shortCode;
  const refund = paisaOrZero(terms.refundPaisa) > 0;
  const noRefund = !refund && terms.noRefundReason === 'DELIVERY_STARTED';
  const fee = formatRs(order.fee.totalPaisa);

  const title = refund
    ? t('orders.cancel.titleRefund', { code })
    : noRefund
      ? t('orders.cancel.titleNoRefund')
      : t('orders.cancel.title', { code });
  const body = refund
    ? t('orders.cancel.bodyRefund', { fee: formatRs(terms.refundPaisa) })
    : noRefund
      ? t('orders.cancel.bodyNoRefund', { fee })
      : undefined;
  const confirmLabel = refund
    ? t('orders.cancel.confirmRefund', { fee: formatRs(terms.refundPaisa) })
    : noRefund
      ? t('orders.cancel.confirmNoRefund')
      : t('orders.cancel.confirm');

  const close = () => {
    setOverride(null);
    onClose();
  };

  return (
    <ConfirmSheet
      visible={visible}
      title={title}
      body={body}
      reasons={ORDER_CANCEL_REASONS.map((reason) => ({ code: reason, label: t(`orders.cancel.reason.${reason}`) }))}
      requireReason
      noteForOther
      noteLabel={t('orders.cancel.noteLabel')}
      confirmLabel={confirmLabel}
      confirmTone={noRefund ? 'danger' : 'primary'}
      confirmLoadingLabel={t('orders.cancel.cancelling')}
      cancelLabel={t('orders.cancel.keep')}
      onClose={close}
      onConfirm={async ({ reasonCode, note }) => {
        if (!reasonCode) return;
        try {
          const result = await cancelOrder(
            order.id,
            {
              reasonCode: reasonCode as (typeof ORDER_CANCEL_REASONS)[number],
              ...(note ? { note } : {}),
              confirmRefundPaisa: terms.refundPaisa,
            },
            idem.key,
          );
          queryClient.setQueryData(qk.orders.byId(order.id), result.order);
          void invalidate.orderPlacedOrCancelled(queryClient);
          const refunded = paisaOrZero(result.refundedPaisa) > 0;
          toast.show({
            message: refunded
              ? t('orders.cancel.doneReturned', { fee: formatRs(result.refundedPaisa) })
              : isPositivePaisa(result.order.fee.totalPaisa)
                ? t('orders.cancel.doneNoRefund')
                : t('orders.cancel.doneFree'),
            tone: 'success',
          });
          setOverride(null);
        } catch (thrown) {
          const error = toApiError(thrown);
          if (error.code === 'ORDER_CANCEL_TERMS_CHANGED') {
            const newRefund = typeof error.details.refundPaisa === 'string' ? error.details.refundPaisa : '0';
            setOverride({
              allowed: true,
              refundPaisa: newRefund,
              noRefundReason: paisaOrZero(newRefund) > 0 ? null : 'DELIVERY_STARTED',
            });
            onRefetch();
            // The sheet stays open with the new terms and this line (UX_MOBILE S11).
            throw t('orders.cancel.termsChanged', { refund: formatRs(newRefund) });
          }
          if (error.code === 'ORDER_HANDOVER_STARTED' || error.code === 'ORDER_NOT_CANCELLABLE') onRefetch();
          throw error;
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  cardLine: { marginTop: space.xs },
  cardLines: { marginTop: space.xs, gap: space.xs },
  cardGap: { marginTop: space.md },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  map: {
    height: 200,
    marginTop: space.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.sunken,
  },
});
