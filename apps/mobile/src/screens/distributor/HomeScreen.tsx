import { useCallback, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  CaseDto,
  DistributorHomeDto,
  OrderDto,
  Page,
  PaymentDto,
  StoreIncomingDto,
  WalletSummary,
} from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { POLL_MS, qk } from '../../api/keys';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import {
  Button,
  Card,
  colors,
  Icon,
  ListRow,
  MoneyText,
  radius,
  Screen,
  Skeleton,
  SkeletonList,
  sizes,
  space,
  StatusChip,
  Text,
  useNoConnection,
  type IconName,
} from '../../ui';
import { cylindersComing } from './receive/receiveModel';
import { fetchHome, fetchMyCases, fetchMyTopups, fetchStoreIncoming } from './shared/api';
import { isPositivePaisa } from './shared/format';
import { useShopNavigation } from './shared/navigation';
import { OrderRow } from './shared/OrderRow';
import { useClients, useOrderPages } from './shared/queries';
import { usePullRefresh, useRefetchOnReturn } from './shared/refresh';
import { savedAtText } from './shared/StaleNotice';

/** Home shows at most this many active orders; "+n more" opens My orders (shop spec §D item 6). */
const ACTIVE_ROWS = 3;

/**
 * S2 Home (UX_MOBILE §4; shop spec §D). The header greets the shop. The wallet card: the balance
 * (never "Rs 0" while loading) with "Low balance" when the server flags it, "Saved 11:08 am" when the
 * data is old, "Being checked" above Rs 0, and Add money. A new shop gets "Get started". Then the
 * status rows, each only while its feature is on (Inc 2/3 spec §2.1): the red customer problems row
 * first, then Receive from driver with what is coming back (polled with `store.incoming`), then the
 * Day-end sheet. Then four tiles (My orders with its count, Customers, History, Refills), up to three
 * active orders, and "New order" as the one main button, or "Call office" while the store isn't set up.
 */
export function DistributorHomeScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const office = useOfficeContact();
  const { config } = useAppConfig();
  const home = useQuery<DistributorHomeDto, ApiError>({ queryKey: qk.home, queryFn: fetchHome });
  const data = home.data;
  const activeCount = data?.orders.active ?? 0;

  // The active rows share My orders' list and poll with it while Home is focused (only when there are any).
  const poll = useFocusedInterval(POLL_MS.ordersList, activeCount > 0);
  const active = useOrderPages('active', { refetchInterval: poll, enabled: activeCount > 0 });
  // "Get started" asks for the customers only when nothing is under way, so most shops never fetch it here.
  const quiet = !!data && data.orders.active === 0 && data.orders.deliveredToday === 0;
  const clients = useClients({ enabled: quiet });
  // [Inc 2] Open customer problems, only while confirmations are switched on (S15).
  const confirmationsOn = config.features.confirmations;
  const cases = useQuery<Page<CaseDto>, ApiError>({
    queryKey: qk.cases.mine,
    queryFn: fetchMyCases,
    enabled: confirmationsOn,
  });
  // [Inc 2] What the vans are bringing back (S13), polled every 15 s while Home is focused.
  const scanFlowOn = config.features.scanFlow;
  const incomingPoll = useFocusedInterval(POLL_MS.storeIncoming, scanFlowOn);
  const incoming = useQuery<StoreIncomingDto, ApiError>({
    queryKey: qk.store.incoming,
    queryFn: fetchStoreIncoming,
    enabled: scanFlowOn,
    refetchInterval: incomingPoll,
  });

  const refetchHome = home.refetch;
  const refetchActive = active.refetch;
  const refetchClients = clients.refetch;
  const refetchCases = cases.refetch;
  const refetchIncoming = incoming.refetch;
  const refetchAll = useCallback(
    () =>
      Promise.all([
        refetchHome(),
        activeCount > 0 ? refetchActive() : undefined,
        quiet ? refetchClients() : undefined,
        confirmationsOn ? refetchCases() : undefined,
        scanFlowOn ? refetchIncoming() : undefined,
      ]),
    [refetchHome, refetchActive, refetchClients, refetchCases, refetchIncoming, activeCount, quiet, confirmationsOn, scanFlowOn],
  );
  const pull = usePullRefresh(refetchAll);
  useRefetchOnReturn(refetchAll);

  // The header says hello once the shop's name is known; "Smart Fleet" until then, or if it fails.
  const businessName = data?.distributor.businessName;
  useEffect(() => {
    navigation.setOptions({ title: businessName ? t('home.greeting', { name: businessName }) : t('common.appName') });
  }, [navigation, businessName, t]);

  const openCases = confirmationsOn ? cases.data?.items ?? [] : [];
  // A failed /store/incoming with nothing saved hides its row; the wallet card's strip says the rest.
  const vans = scanFlowOn ? incoming.data?.vans : undefined;
  const coming = vans ? cylindersComing(vans) : 0;
  const openReceive = () => {
    // With exactly one van, the list is skipped and the scan opens (S13).
    if (vans && vans.length === 1) navigation.navigate('ReceiveScan', { vehicleId: vans[0].vehicle.id });
    else navigation.navigate('ReceiveList');
  };
  const storeSet = data?.distributor.storeSet ?? true;
  const accountActive = data ? data.distributor.status === 'ACTIVE' : true;
  const blocked = !storeSet || !accountActive;
  const showGetStarted = quiet && clients.data?.length === 0;

  const footer = blocked ? (
    <>
      <Text align="center">{!accountActive ? t('home.notActive') : t('home.noStore')}</Text>
      {office.phone ? (
        <Button label={t('common.actions.callOffice')} onPress={office.call} size="lg" icon="call" />
      ) : (
        <Button label={t('home.newOrder')} onPress={() => undefined} size="lg" icon="order" disabled />
      )}
    </>
  ) : (
    <Button label={t('home.newOrder')} onPress={() => navigation.navigate('NewOrder')} size="lg" icon="order" />
  );

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
      <View style={styles.stack}>
        <WalletCard
          wallet={data?.wallet}
          loading={home.isPending}
          failed={home.isError && !data}
          savedAt={home.isError && data ? home.dataUpdatedAt : null}
          onRetry={() => void home.refetch()}
          onAddMoney={() => navigation.navigate('TopupAmount')}
          onBeingChecked={(one) =>
            one ? navigation.navigate('TopupStatus', { id: one.id }) : navigation.navigate('Wallet', { filter: 'topups' })
          }
        />

        {showGetStarted && data ? (
          <GetStarted
            moneyIn={isPositivePaisa(data.wallet.balancePaisa) || isPositivePaisa(data.wallet.pendingTopupPaisa)}
            onAddMoney={() => navigation.navigate('TopupAmount')}
            onAddCustomer={() => navigation.navigate('AddCustomer')}
            onNewOrder={() => navigation.navigate('NewOrder')}
          />
        ) : null}

        {openCases.length > 0 ? (
          <StatusRow
            tone="danger"
            icon="error"
            title={t('home.problems', { count: openCases.length })}
            subtitle={t('home.problemsHelp')}
            onPress={() =>
              openCases.length === 1
                ? navigation.navigate('OrderDetail', { orderId: openCases[0].order.id })
                : navigation.navigate('Cases')
            }
          />
        ) : null}
        {vans ? (
          <StatusRow
            icon="store"
            title={t('home.tiles.receive')}
            subtitle={coming > 0 ? t('home.tiles.receiveComing', { count: coming }) : t('home.tiles.receiveNone')}
            subtitleStrong={coming > 0}
            onPress={openReceive}
            testID="home.receive"
          />
        ) : null}
        {config.features.dayEnd ? (
          <StatusRow
            icon="sheet"
            title={t('home.tiles.dayEnd')}
            subtitle={t('home.tiles.dayEndHelp')}
            onPress={() => navigation.navigate('DayEnd')}
            testID="home.dayEnd"
          />
        ) : null}

        <TileGrid>
          {[
            <HomeTile
              key="orders"
              icon="order"
              label={t('home.tiles.orders')}
              badge={activeCount > 0 ? String(activeCount) : undefined}
              accessibilityLabel={activeCount > 0 ? t('home.tiles.ordersA11y', { count: activeCount }) : undefined}
              onPress={() => navigation.navigate('Orders')}
            />,
            <HomeTile
              key="customers"
              icon="customers"
              label={t('home.tiles.customers')}
              onPress={() => navigation.navigate('Customers')}
            />,
            <HomeTile
              key="history"
              icon="wallet"
              label={t('home.tiles.history')}
              onPress={() => navigation.navigate('Wallet')}
            />,
            ...(config.features.refills
              ? [
                  <HomeTile
                    key="refills"
                    icon="cylinder"
                    label={t('home.tiles.refills')}
                    onPress={() => navigation.navigate('Refills')}
                  />,
                ]
              : []),
          ]}
        </TileGrid>

        {activeCount > 0 && !(active.isError && !active.data) ? (
          <ActiveOrders
            orders={active.data?.pages.flatMap((page) => page.items)}
            total={active.data && !active.hasNextPage ? active.data.pages.flatMap((page) => page.items).length : activeCount}
            onOpen={(order) => navigation.navigate('OrderDetail', { orderId: order.id })}
            onMore={() => navigation.navigate('Orders', { tab: 'active' })}
          />
        ) : null}
      </View>
    </Screen>
  );
}

interface WalletCardProps {
  wallet: WalletSummary | undefined;
  loading: boolean;
  failed: boolean;
  /** Set when the balance shown is saved data whose refresh failed. */
  savedAt: number | null;
  onRetry: () => void;
  onAddMoney: () => void;
  /** Opens the one top-up being checked, or History on "Top-ups" when there are several. */
  onBeingChecked: (one: PaymentDto | null) => void;
}

/** The wallet card (agreed sample screen 1): brand background, white text, never "Rs 0" while loading. */
function WalletCard({ wallet, loading, failed, savedAt, onRetry, onAddMoney, onBeingChecked }: WalletCardProps) {
  const { t } = useTranslation();
  const bannerShowing = useNoConnection();
  const pendingCount = wallet?.pendingTopupCount ?? 0;
  const showPending = !!wallet && isPositivePaisa(wallet.pendingTopupPaisa);
  // With one request being checked, the row opens it; the id comes from the shop's top-up list.
  const mine = useQuery<PaymentDto[], ApiError>({
    queryKey: qk.topups.mine,
    queryFn: fetchMyTopups,
    enabled: showPending && pendingCount === 1,
  });
  const onePending = pendingCount === 1 ? mine.data?.find((p) => p.stage === 'BEING_CHECKED') ?? null : null;
  // Nothing saved and no connection: the card says so at once, not after the retries (which go on).
  const unavailable = failed || (!wallet && loading && bannerShowing);

  return (
    <Card tone="brand" rounded="lg" padding={space.lg}>
      <Text variant="label" tone="onBrandMuted">
        {t('wallet.card.balance')}
      </Text>
      {wallet ? (
        <View style={styles.balanceRow}>
          <MoneyText paisa={wallet.balancePaisa} variant="display" tone="onBrand" numberOfLines={1} testID="home-balance" />
          {wallet.lowBalance ? <StatusChip tone="warning" icon="warn" label={t('home.lowBalance')} /> : null}
        </View>
      ) : loading && !unavailable ? (
        <View style={styles.skeletons} accessibilityLabel={t('common.loading')}>
          <Skeleton width="55%" height={40} />
          <Skeleton width="35%" height={16} />
        </View>
      ) : null}

      {unavailable ? (
        <View style={styles.cardError} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text tone="onBrand">{t('wallet.card.loadError')}</Text>
          {/* While the "No connection" banner shows, its Try again is the only one. */}
          {bannerShowing ? null : (
            <Button label={t('common.actions.tryAgain')} onPress={onRetry} variant="inverse" fullWidth={false} />
          )}
        </View>
      ) : null}

      {wallet && savedAt !== null ? (
        <View style={styles.saved}>
          <Icon name="history" size={20} tone="onBrandMuted" />
          <Text variant="caption" tone="onBrandMuted" style={styles.flex}>
            {t('common.stale', { time: savedAtText(savedAt) })}
          </Text>
          {/* While the "No connection" banner shows, its Try again is the only one. */}
          {!bannerShowing ? <OnBrandLink label={t('common.actions.tryAgain')} onPress={onRetry} /> : null}
        </View>
      ) : null}

      {showPending ? (
        <Pressable
          onPress={() => onBeingChecked(onePending)}
          accessibilityRole="button"
          accessibilityHint={t('wallet.card.beingCheckedHint')}
          android_ripple={{ color: colors.rippleOnBrand }}
          style={styles.pendingRow}
        >
          <Icon name="checking" size={20} tone="onBrand" />
          <Text tone="onBrand" style={styles.flex}>
            {t('wallet.card.beingChecked')}
          </Text>
          <MoneyText paisa={wallet.pendingTopupPaisa} variant="bodyStrong" tone="onBrand" />
          <Icon name="chevron" size={20} tone="onBrand" />
        </Pressable>
      ) : null}

      {wallet ? (
        <Button
          label={t('wallet.card.addMoney')}
          onPress={onAddMoney}
          variant="inverse"
          icon="addMoney"
          style={styles.addMoney}
        />
      ) : null}
    </Card>
  );
}

/** A text button in white on the wallet card ("Try again" after "Saved 11:08 am"), 48 dp tall. */
function OnBrandLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={sizes.hitSlop}
      android_ripple={{ color: colors.rippleOnBrand }}
      style={styles.onBrandLink}
    >
      <Text variant="label" tone="onBrand">
        {label}
      </Text>
    </Pressable>
  );
}

/** A new shop's first three steps (shop spec §D item 3). "Add money" gets a tick once money is in. */
function GetStarted({
  moneyIn,
  onAddMoney,
  onAddCustomer,
  onNewOrder,
}: {
  moneyIn: boolean;
  onAddMoney: () => void;
  onAddCustomer: () => void;
  onNewOrder: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card padding={0}>
      <Text variant="heading" style={styles.cardTitle}>
        {t('home.getStarted.title')}
      </Text>
      <ListRow
        leadingIcon="addMoney"
        title={t('home.getStarted.addMoney')}
        onPress={onAddMoney}
        chevron={!moneyIn}
        trailing={moneyIn ? <Icon name="ok" size={24} tone="success" label={t('home.getStarted.done')} /> : undefined}
      />
      <Divider />
      <ListRow leadingIcon="customer" title={t('home.getStarted.addCustomer')} onPress={onAddCustomer} chevron />
      <Divider />
      <ListRow leadingIcon="order" title={t('home.getStarted.newOrder')} onPress={onNewOrder} chevron />
    </Card>
  );
}

/**
 * A status row above the tiles (Inc 2/3 spec §2.1; the `HubTile` row): an icon in its circle, a bold
 * title, one grey line and a chevron. The customer problems row is red (`danger`, the `error` icon);
 * Receive and Day-end use the default card, with Receive's live count in bold brand text.
 */
function StatusRow({
  icon,
  title,
  subtitle,
  subtitleStrong = false,
  tone = 'default',
  onPress,
  testID,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  /** The grey line carries a live count: bold brand text ("3 coming back"). */
  subtitleStrong?: boolean;
  tone?: 'default' | 'danger';
  onPress: () => void;
  testID?: string;
}) {
  const danger = tone === 'danger';
  return (
    <Card onPress={onPress} tone={tone} accessibilityLabel={`${title}, ${subtitle}`} testID={testID}>
      <View style={styles.statusRow}>
        <View style={[styles.statusIcon, danger ? null : styles.statusIconDefault]}>
          <Icon name={icon} size={24} tone={danger ? 'danger' : 'brand'} />
        </View>
        <View style={styles.flex}>
          <Text variant="heading">{title}</Text>
          <Text variant={subtitleStrong ? 'bodyStrong' : 'body'} tone={subtitleStrong ? 'brand' : 'secondary'}>
            {subtitle}
          </Text>
        </View>
        <Icon name="chevron" size={24} tone="secondary" />
      </View>
    </Card>
  );
}

/** Two tiles a row; an odd last tile keeps half the width. */
function TileGrid({ children }: { children: ReactNode[] }) {
  const rows: ReactNode[][] = [];
  for (let i = 0; i < children.length; i += 2) rows.push(children.slice(i, i + 2));
  return (
    <View style={styles.grid}>
      {rows.map((pair, index) => (
        <View key={index} style={styles.gridRow}>
          {pair}
          {pair.length === 1 ? <View style={styles.flex} /> : null}
        </View>
      ))}
    </View>
  );
}

/** A Home tile (shop spec §D item 5): an icon in its circle and one or two words, at least 96 dp tall. */
function HomeTile({
  icon,
  label,
  badge,
  accessibilityLabel,
  onPress,
}: {
  icon: IconName;
  label: string;
  /** A count in the top end corner (My orders' active orders). */
  badge?: string;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Card onPress={onPress} style={styles.tile} accessibilityLabel={accessibilityLabel ?? label}>
      <View style={styles.tileIcon}>
        <Icon name={icon} size={32} tone="brand" />
      </View>
      <Text variant="heading" align="center" numberOfLines={2}>
        {label}
      </Text>
      {badge ? (
        <View style={styles.badge} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <StatusChip tone="brand" label={badge} />
        </View>
      ) : null}
    </Card>
  );
}

/** "Active orders": up to three rows, newest first, and "+n more" (shop spec §D item 6). */
function ActiveOrders({
  orders,
  total,
  onOpen,
  onMore,
}: {
  /** The active list's rows, or undefined while it loads. */
  orders: OrderDto[] | undefined;
  total: number;
  onOpen: (order: OrderDto) => void;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  const shown = orders?.slice(0, ACTIVE_ROWS) ?? [];
  const more = Math.max(0, total - shown.length);
  return (
    <View style={styles.section}>
      <Text variant="label" tone="secondary" accessibilityRole="header">
        {t('home.activeTitle')}
      </Text>
      {orders === undefined ? (
        <SkeletonList rows={2} />
      ) : shown.length > 0 ? (
        <Card padding={0}>
          {shown.map((order, index) => (
            <View key={order.id}>
              {index > 0 ? <Divider /> : null}
              <OrderRow order={order} onPress={() => onOpen(order)} />
            </View>
          ))}
          {more > 0 ? (
            <>
              <Divider />
              <Pressable
                onPress={onMore}
                accessibilityRole="button"
                android_ripple={{ color: colors.ripple }}
                style={styles.moreRow}
              >
                <Text variant="bodyStrong" tone="brand" style={styles.flex}>
                  {t('home.moreOrders', { count: more })}
                </Text>
                <Icon name="chevron" size={24} tone="brand" />
              </Pressable>
            </>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  balanceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: space.xs },
  skeletons: { gap: space.sm, paddingVertical: space.xs },
  cardError: { gap: space.md, paddingVertical: space.sm, alignItems: 'flex-start' },
  saved: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  onBrandLink: {
    minHeight: sizes.touch,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  // No tint behind it: white text stays on the full wallet colour (6.75:1).
  pendingRow: {
    minHeight: sizes.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.onBrandSubtle,
    overflow: 'hidden',
  },
  addMoney: { marginTop: space.lg },
  cardTitle: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // On the white card the circle is the tiles' brandSoft one.
  statusIconDefault: { backgroundColor: colors.brandSoft },
  grid: { gap: space.md },
  gridRow: { flexDirection: 'row', gap: space.md },
  tile: { flex: 1, minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', top: space.sm, end: space.sm },
  section: { gap: space.sm },
  moreRow: {
    minHeight: sizes.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
  },
  divider: { height: 1, backgroundColor: colors.border },
});
