import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Linking, StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_CANCEL_REASONS, type OrderCancelTerms, type OrderDto, type OrderStage } from '@smartfleet/shared-types';
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
  ltr,
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
import { useCustomerAnswer } from './confirm/CustomerAnswer';
import { cancelOrder, fetchOrder, fetchOrderTracking, type OrderTrackingDto } from './shared/api';
import { CallButton } from './shared/CallButton';
import { costParts, feeText, isPositivePaisa, orderCost, paisaOrZero, phoneText } from './shared/format';
import { shopKeys } from './shared/keys';
import { useShopNavigation, useShopRoute } from './shared/navigation';
import { usePullRefresh } from './shared/refresh';
import { visitFromConfirmation, visitFromOrder, type TakenBackState, type VisitSummary } from './shared/visit';

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT']);
/** The stages with a driver on the order: "Call driver" is the footer and the facts show the driver. */
const DRIVER_STAGES: ReadonlySet<OrderStage> = new Set(['DRIVER_ASSIGNED', 'LOADING', 'ON_THE_WAY']);
/** A finished order shows one status line instead of the timeline, until "All steps" (shop spec §T). */
const FINISHED_STAGES: ReadonlySet<OrderStage> = new Set(['DELIVERED', 'CANCELLED', 'NOT_DELIVERED']);
const TRACKING_DELTA = 0.03;

/** Nothing to return when a cancel can't refund and nothing was paid; a cost kept is "no refund". */
function cancelWords(terms: OrderCancelTerms, order: OrderDto): 'refund' | 'noRefund' | 'nothing' {
  if (paisaOrZero(terms.refundPaisa) > 0) return 'refund';
  if (terms.noRefundReason === 'DELIVERY_STARTED' && isPositivePaisa(order.fee.totalPaisa)) return 'noRefund';
  return 'nothing';
}

/**
 * S11 Order detail (shop spec §T): the stage chip, the timeline while the order is under way (a
 * finished order shows one line, with "All steps"), one facts card (customer with a call button,
 * driver, cylinders, cost), the driver on the map while on the way, and the red-outline cancel at
 * the end of the content (never the footer). "Call driver" is the footer while a driver has the
 * order. The cancel sheet's words come from the order's own terms, and it sends the refund the person
 * saw.
 *
 * [Inc 2] A delivered order (S14) adds the customer answer card under the status block, whose main
 * button is then the footer (CUSTOMER_PAGE §10), and its facts card shows what was delivered and taken
 * back in place of the cylinders line, with the cost line "Delivery cost Rs 480 · paid when the order
 * was placed". No money moves on any of it.
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
  // [Inc 2] The customer answer (only while confirmations are on and the order has one).
  const answer = useCustomerAnswer(order.data);

  useEffect(() => {
    navigation.setOptions({
      title: order.data ? t('orders.detail.title', { code: order.data.shortCode }) : t('orders.detail.titleLoading'),
    });
  }, [navigation, order.data, t]);

  const notFound = !order.data && isApiError(order.error) && order.error.status === 404;
  const driverPhone = order.data && DRIVER_STAGES.has(order.data.stage) ? order.data.trip?.driver.phone : null;

  return (
    <Screen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        driverPhone ? (
          <Button
            label={t('orders.detail.callDriver')}
            onPress={() => void Linking.openURL(telUrl(driverPhone)).catch(() => undefined)}
            size="lg"
            icon="call"
          />
        ) : (
          answer.footer ?? undefined
        )
      }
    >
      {notFound ? (
        <EmptyState icon="order" title={t('orders.detail.notFound')} />
      ) : (
        <QueryBoundary query={order} skeleton={<SkeletonCard lines={5} />}>
          {(data) => (
            <OrderBody
              order={data}
              onCancel={() => setSheetOpen(true)}
              answerCard={answer.card}
              visit={
                data.status === 'DELIVERED'
                  ? (visitFromOrder(data) ?? (answer.view ? visitFromConfirmation(data, answer.view) : null))
                  : null
              }
            />
          )}
        </QueryBoundary>
      )}
      {answer.overlays}
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

function OrderBody({
  order,
  onCancel,
  answerCard,
  visit,
}: {
  order: OrderDto;
  onCancel: () => void;
  /** [Inc 2] The customer answer card, under the status block (null when there is none). */
  answerCard: ReactNode;
  /** [Inc 2] What was delivered and taken back, once known. */
  visit: VisitSummary | null;
}) {
  const { t } = useTranslation();
  const finished = FINISHED_STAGES.has(order.stage);
  const [allSteps, setAllSteps] = useState(false);
  const words = cancelWords(order.cancel, order);

  return (
    <View style={styles.stack}>
      <View style={styles.status}>
        <StatusChip kind="order" value={order.stage} />
        {order.stage === 'NEEDS_DRIVER' ? (
          <Text variant="caption" tone="secondary">
            {t('orders.new.officeAssigns')}
          </Text>
        ) : null}
        {finished ? (
          <Text variant="caption" tone="secondary">
            {statusLineOf(order, t)}
          </Text>
        ) : null}
        {finished && !allSteps ? (
          <Button
            label={t('orders.detail.allSteps')}
            onPress={() => setAllSteps(true)}
            variant="ghost"
            fullWidth={false}
            style={styles.ghost}
          />
        ) : null}
      </View>

      {answerCard}

      {!finished || allSteps ? (
        <Card>
          <Timeline items={timelineOf(order, t)} />
        </Card>
      ) : null}

      <FactsCard order={order} visit={visit} />

      {order.stage === 'ON_THE_WAY' ? <TrackingCard order={order} /> : null}

      {order.cancel.allowed ? (
        <Button
          label={words === 'noRefund' ? t('orders.detail.cancelNoRefund') : t('orders.detail.cancel')}
          onPress={onCancel}
          variant="dangerOutline"
          style={styles.cancel}
        />
      ) : null}
    </View>
  );
}

/** A finished order's caption: "Today, 11:02 am", or with why: "Today, 10:30 am · Customer cancelled". */
function statusLineOf(order: OrderDto, t: TFunction): string {
  if (order.stage === 'CANCELLED') {
    const when = order.cancelledAt ? formatWhenText(order.cancelledAt) : '';
    const reason = order.cancelReasonCode ? t(`orders.cancel.reason.${order.cancelReasonCode}`) : null;
    return reason && when ? t('orders.detail.statusLine', { when, reason }) : reason ?? when;
  }
  if (order.stage === 'NOT_DELIVERED') {
    const when = order.failedAt ? formatWhenText(order.failedAt) : '';
    const reason = order.failureReasonCode ? t(`orders.detail.failureReason.${order.failureReasonCode}`) : null;
    return reason && when ? t('orders.detail.statusLine', { when, reason }) : reason ?? when;
  }
  return order.deliveredAt ? formatWhenText(order.deliveredAt) : '';
}

/**
 * Placed · {{fee}} paid → Driver assigned → Loading → On the way → Delivered, each with its time. A
 * cancelled order ends with the neutral "stopped" mark ("Cancelled · Rs 400 returned"), never a tick;
 * one that wasn't delivered ends red with its reason.
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
        state: 'stopped',
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

/**
 * The facts (shop spec §T item 4): customer, driver while active, cylinders and cost, one card. A
 * delivered order shows what was delivered and taken back in place of the cylinders line once the
 * visit's lists are known (S14), and its cost as one line instead of the chip.
 */
function FactsCard({ order, visit }: { order: OrderDto; visit: VisitSummary | null }) {
  const { t } = useTranslation();
  const trip = order.trip;
  const showDriver = !!trip && DRIVER_STAGES.has(order.stage);
  const charged = order.fee.status !== 'NONE' && isPositivePaisa(order.fee.totalPaisa);
  const cancelled = order.stage === 'CANCELLED';
  const delivered = order.stage === 'DELIVERED';
  const cost = orderCost(order);
  const parts = charged && !cancelled && cost ? costParts(cost, t) : null;
  const kept = cancelled && order.fee.status === 'DEDUCTED' && charged;

  return (
    <Card padding={0}>
      <Section first>
        <View style={styles.between}>
          <View style={styles.flex}>
            <Text variant="bodyStrong">
              {t('orders.new.customerValue', { name: order.client.name, phone: phoneText(order.client.phone) })}
            </Text>
            <Text tone="secondary">{order.deliveryAddressLabel}</Text>
          </View>
          {order.client.phone ? (
            <CallButton phone={order.client.phone} label={t('orders.detail.callCustomer', { name: order.client.name })} />
          ) : null}
        </View>
      </Section>

      {showDriver && trip ? (
        <Section>
          <View style={styles.between}>
            <Icon name="truck" size={24} tone="brand" />
            <Text style={styles.flex}>
              {trip.vehicle?.plateNo
                ? t('orders.detail.driverLine', {
                    name: trip.driver.name,
                    van: t('orders.detail.van', { plate: trip.vehicle.plateNo }),
                  })
                : trip.driver.name}
            </Text>
          </View>
        </Section>
      ) : null}

      {delivered && visit ? (
        <VisitSection visit={visit} />
      ) : (
        <Section>
          {order.lines.map((line) => (
            <Text key={line.id}>
              {line.expectedReturnCount > 0
                ? t('orders.detail.itemLine', { count: line.fullCount, size: line.sizeLabel, back: line.expectedReturnCount })
                : t('orders.detail.itemLineNoBack', { count: line.fullCount, size: line.sizeLabel })}
            </Text>
          ))}
        </Section>
      )}

      <Section>
        {delivered && charged ? (
          <Text>{t('orders.detail.costPaid', { fee: feeText(order.fee.totalPaisa) })}</Text>
        ) : (
          <View style={styles.between}>
            <Text variant="label" tone="secondary" style={styles.flex}>
              {t('orders.detail.costTitle')}
            </Text>
            <StatusChip kind="fee" value={order.fee.status} amountPaisa={order.fee.totalPaisa} />
          </View>
        )}
        {parts ? (
          <Text variant="caption" tone="secondary">
            {parts}
          </Text>
        ) : null}
        {kept ? (
          <Text variant="caption" tone="secondary">
            {t('orders.detail.noRefund')}
          </Text>
        ) : null}
      </Section>
    </Card>
  );
}

function Section({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return <View style={[styles.section, first ? null : styles.divided]}>{children}</View>;
}

const STATE_ICONS: Record<TakenBackState, 'empty' | 'partFilled' | 'full'> = {
  EMPTY: 'empty',
  PART_FILLED: 'partFilled',
  FULL: 'full',
};

/**
 * [Inc 2] Delivered (`customer`): one line per size, "2 × 11.8 kg", or "11.8 kg · 1 of 2" when short.
 * Taken back (`cylinder`): one line per state with the numbers ("Empty · AG-C0011"), the unlabelled ones
 * as "Empty · No label · 1 × 11.8 kg", and "2 expected" when the total differs from the order's
 * take-back (Inc 2/3 spec §2.4). Without the order's visit list, the link's snapshot gives counts only.
 */
function VisitSection({ visit }: { visit: VisitSummary }) {
  const { t } = useTranslation();
  const showTakenBack = visit.takenBack.length > 0 || visit.expected > 0;
  return (
    <Section>
      <View style={styles.between}>
        <Icon name="customer" size={20} tone="secondary" />
        <Text variant="label" tone="secondary" style={styles.flex}>
          {t('orders.detail.delivered')}
        </Text>
      </View>
      {visit.delivered.map((line) => (
        <Text key={line.key} style={styles.indented}>
          {line.short
            ? t('orders.detail.deliveredShort', { size: line.sizeLabel, done: line.count, total: line.needed })
            : t('orders.detail.deliveredLine', { count: line.count, size: line.sizeLabel })}
        </Text>
      ))}
      {showTakenBack ? (
        <>
          <View style={[styles.between, styles.subheading]}>
            <Icon name="cylinder" size={20} tone="secondary" />
            <Text variant="label" tone="secondary" style={styles.flex}>
              {t('orders.detail.takenBack')}
            </Text>
          </View>
          {visit.takenBack.map((line) => {
            const state = t(`orders.detail.state.${line.state}`);
            return (
              <View key={line.key} style={[styles.between, styles.indented]}>
                <Icon name={STATE_ICONS[line.state]} size={16} tone="secondary" />
                <Text style={styles.flex} tabular={Boolean(line.numbers)}>
                  {line.numbers
                    ? t('orders.detail.takenBackNumbers', { state, numbers: line.numbers.map((no) => ltr(no)).join(', ') })
                    : line.unlabelled
                      ? t('orders.detail.noLabel', { state, count: line.count, size: line.sizeLabel })
                      : t('orders.detail.takenBackCount', { state, count: line.count, size: line.sizeLabel })}
                </Text>
              </View>
            );
          })}
          {visit.takenTotal !== visit.expected ? (
            <Text variant="caption" tone="secondary" style={styles.indented}>
              {t('orders.detail.expected', { count: visit.expected })}
            </Text>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}

/**
 * While on the way: the driver's last position, polled every 20 seconds (`/orders/:id/tracking`). It
 * shows only once a position exists; there is no "will show here" text.
 */
function TrackingCard({ order }: { order: OrderDto }) {
  const { t } = useTranslation();
  const poll = useFocusedInterval(POLL_MS.orderOnTheWay);
  const tracking = useQuery<OrderTrackingDto, ApiError>({
    queryKey: shopKeys.tracking(order.id),
    queryFn: () => fetchOrderTracking(order.id),
    refetchInterval: poll,
  });
  const driver = tracking.data?.driverLocation ?? null;
  if (!driver) return null;
  const destination = tracking.data?.destination ?? order.destination;

  return (
    <Card>
      <Text variant="label" tone="secondary">
        {t('orders.detail.trackingTitle')}
      </Text>
      <View style={styles.map} accessible accessibilityLabel={t('orders.detail.trackingMapA11y')}>
        <MapView
          style={StyleSheet.absoluteFill}
          region={{
            latitude: driver.lat,
            longitude: driver.lng,
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
    </Card>
  );
}

/**
 * The cancel sheet (shop spec §U). The money comes first and big: "Back to your wallet Rs 330" while a
 * refund is due, or "Delivery has started." with "Not returned Rs 400" (a danger confirm) once it has
 * started. "Why?" asks for a reason; "Other" asks what happened. `ORDER_CANCEL_TERMS_CHANGED` keeps
 * the sheet open with the new terms and the line "Delivery has just started. The refund is now Rs 0.".
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
  const words = cancelWords(terms, order);

  const title =
    words === 'refund'
      ? t('orders.cancel.titleRefund', { code })
      : words === 'noRefund'
        ? t('orders.cancel.titleNoRefund')
        : t('orders.cancel.title', { code });
  const confirmLabel =
    words === 'refund'
      ? t('orders.cancel.confirmRefund', { fee: formatRs(terms.refundPaisa) })
      : words === 'noRefund'
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
      body={words === 'noRefund' ? t('orders.cancel.bodyNoRefund') : undefined}
      amountPaisa={words === 'refund' ? terms.refundPaisa : words === 'noRefund' ? order.fee.totalPaisa : undefined}
      amountLabel={
        words === 'refund' ? t('orders.cancel.backToWallet') : words === 'noRefund' ? t('orders.cancel.notReturned') : undefined
      }
      reasons={ORDER_CANCEL_REASONS.map((reason) => ({ code: reason, label: t(`orders.cancel.reason.${reason}`) }))}
      requireReason
      noteForOther
      noteLabel={t('orders.cancel.noteLabel')}
      confirmLabel={confirmLabel}
      confirmTone={words === 'noRefund' ? 'danger' : 'primary'}
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
  status: { gap: space.xs, alignItems: 'flex-start' },
  ghost: { paddingHorizontal: space.sm, marginStart: -space.sm },
  section: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  between: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // The visit's lines start under their heading's words, past its 20 dp icon.
  indented: { marginStart: 20 + space.sm },
  subheading: { marginTop: space.sm },
  // 24 dp below the last card (the stack's 16 plus 8).
  cancel: { marginTop: space.sm },
  map: {
    height: 200,
    marginTop: space.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.sunken,
  },
});
