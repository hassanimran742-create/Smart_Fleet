import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { CaseDto, DistributorHomeDto, Page, PaymentDto, WalletSummary } from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import {
  Button,
  Card,
  colors,
  Icon,
  MoneyText,
  radius,
  Screen,
  Skeleton,
  sizes,
  space,
  Text,
  type IconName,
} from '../../ui';
import { fetchHome, fetchMyCases, fetchMyTopups } from './shared/api';
import { isPositivePaisa } from './shared/format';
import { useShopNavigation } from './shared/navigation';
import { usePullRefresh, useRefetchOnReturn } from './shared/refresh';
import { savedAtText, StaleNotice } from './shared/StaleNotice';

/**
 * S2 Home (UX_MOBILE §4): the wallet card (Balance, "Being checked" only above Rs 0, Add money,
 * History), the low-balance card, the store-not-set state, the Today row and the tiles, with
 * "New order" as the one primary action. Data: `GET /distributor/home`. While it loads the card shows
 * placeholders, never "Rs 0".
 */
export function DistributorHomeScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const office = useOfficeContact();
  const { config } = useAppConfig();
  const home = useQuery<DistributorHomeDto, ApiError>({ queryKey: qk.home, queryFn: fetchHome });
  // [Inc 2] Open customer problems, only while confirmations are switched on (S15).
  const cases = useQuery<Page<CaseDto>, ApiError>({
    queryKey: qk.cases.mine,
    queryFn: fetchMyCases,
    enabled: config.features.confirmations,
  });
  const confirmationsOn = config.features.confirmations;
  const refetchCases = cases.refetch;
  const refetchAll = useCallback(
    () => Promise.all([home.refetch(), confirmationsOn ? refetchCases() : undefined]),
    [home.refetch, confirmationsOn, refetchCases],
  );
  const pull = usePullRefresh(refetchAll);
  useRefetchOnReturn(refetchAll);
  const openCases = config.features.confirmations ? cases.data?.items ?? [] : [];

  const data = home.data;
  const storeSet = data?.distributor.storeSet ?? true;
  const active = data ? data.distributor.status === 'ACTIVE' : true;
  const stale = home.isError && data !== undefined;

  return (
    <Screen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        <>
          {!storeSet ? (
            <Text variant="caption" tone="warning" align="center">
              {t('home.noStore')}
            </Text>
          ) : null}
          <Button
            label={t('home.newOrder')}
            onPress={() => navigation.navigate('NewOrder')}
            size="lg"
            icon="order"
            disabled={!storeSet}
          />
        </>
      }
    >
      <View style={styles.stack}>
        {stale ? <StaleNotice updatedAt={home.dataUpdatedAt} onRetry={() => void home.refetch()} /> : null}

        {data ? (
          <Text variant="title">{t('home.greeting', { name: data.distributor.businessName })}</Text>
        ) : home.isPending ? (
          <Skeleton width="60%" height={28} />
        ) : null}

        <WalletCard
          wallet={data?.wallet}
          loading={home.isPending}
          failed={home.isError && !data}
          updatedAt={stale ? home.dataUpdatedAt : null}
          onRetry={() => void home.refetch()}
          onAddMoney={() => navigation.navigate('TopupAmount')}
          onHistory={() => navigation.navigate('Wallet')}
          onBeingChecked={(latest) =>
            latest ? navigation.navigate('TopupStatus', { id: latest.id }) : navigation.navigate('Wallet', { filter: 'requests' })
          }
        />

        {data?.wallet.lowBalance ? (
          <Card tone="warning">
            <View style={styles.cardRow}>
              <Icon name="warn" size={24} tone="warning" />
              <Text style={styles.flex}>{t('home.lowBalance')}</Text>
            </View>
            <Button
              label={t('wallet.card.addMoney')}
              onPress={() => navigation.navigate('TopupAmount')}
              icon="addMoney"
              variant="secondary"
              fullWidth={false}
              style={styles.cardAction}
            />
          </Card>
        ) : null}

        {!storeSet || !active ? (
          <Card tone="warning">
            <View style={styles.cardRow}>
              <Icon name="store" size={24} tone="warning" />
              <Text style={styles.flex}>{!active ? t('home.notActive') : t('home.noStore')}</Text>
            </View>
            {office.phone ? (
              <Button
                label={t('common.actions.callOffice')}
                onPress={office.call}
                icon="call"
                variant="secondary"
                fullWidth={false}
                style={styles.cardAction}
              />
            ) : null}
          </Card>
        ) : null}

        {openCases.length > 0 ? (
          <HubTile
            icon="warn"
            tone="warning"
            title={t('home.problems', { count: openCases.length })}
            subtitle={t('home.problemsHelp')}
            onPress={() =>
              openCases.length === 1
                ? navigation.navigate('OrderDetail', { orderId: openCases[0].order.id })
                : navigation.navigate('Cases')
            }
          />
        ) : null}

        {data ? (
          <HubTile
            icon="truck"
            title={t('home.todayLabel')}
            subtitle={t('home.today', { count: data.orders.active })}
            onPress={() => navigation.navigate('Orders', { tab: 'active' })}
          />
        ) : home.isPending ? (
          <Skeleton height={sizes.listRow} rounded={radius.md} />
        ) : null}

        <View style={styles.tiles}>
          <HubTile
            icon="order"
            title={t('home.tiles.orders')}
            subtitle={t('home.tiles.ordersHelp')}
            onPress={() => navigation.navigate('Orders')}
          />
          {config.features.refills ? (
            <HubTile
              icon="cylinder"
              title={t('home.tiles.refills')}
              subtitle={t('home.tiles.refillsHelp')}
              onPress={() => navigation.navigate('RequestFilling')}
            />
          ) : null}
          {/* Receive from driver (features.scanFlow, Inc 2) and Day-end sheet (features.dayEnd, Inc 3) join here with their screens. */}
        </View>
      </View>
    </Screen>
  );
}

interface WalletCardProps {
  wallet: WalletSummary | undefined;
  loading: boolean;
  failed: boolean;
  /** Set when the shown balance is saved data whose refresh failed. */
  updatedAt: number | null;
  onRetry: () => void;
  onAddMoney: () => void;
  onHistory: () => void;
  /** Opens the one top-up being checked, or the "Top-up requests" list when there are several. */
  onBeingChecked: (latest: PaymentDto | null) => void;
}

/** The wallet card (agreed sample screen 1): brand background, white text, never "Rs 0" while loading. */
function WalletCard({ wallet, loading, failed, updatedAt, onRetry, onAddMoney, onHistory, onBeingChecked }: WalletCardProps) {
  const { t } = useTranslation();
  const pendingCount = wallet?.pendingTopupCount ?? 0;
  const showPending = !!wallet && isPositivePaisa(wallet.pendingTopupPaisa);
  // With one request being checked, the row opens it; the id comes from the shop's top-up list.
  const mine = useQuery<PaymentDto[], ApiError>({
    queryKey: qk.topups.mine,
    queryFn: fetchMyTopups,
    enabled: showPending && pendingCount === 1,
  });
  const latestPending = pendingCount === 1 ? mine.data?.find((p) => p.stage === 'BEING_CHECKED') ?? null : null;

  return (
    <Card tone="brand" rounded="lg" padding={space.lg}>
      <Text variant="label" tone="onBrandMuted">
        {t('wallet.card.balance')}
      </Text>
      {wallet ? (
        <MoneyText paisa={wallet.balancePaisa} variant="display" tone="onBrand" testID="home-balance" />
      ) : loading ? (
        <View style={styles.skeletons} accessibilityLabel={t('common.loading')}>
          <Skeleton width="55%" height={40} />
          <Skeleton width="35%" height={16} />
        </View>
      ) : null}

      {failed ? (
        <View style={styles.cardError} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text tone="onBrand">{t('wallet.card.loadError')}</Text>
          <Button label={t('common.actions.tryAgain')} onPress={onRetry} variant="inverse" fullWidth={false} />
        </View>
      ) : null}

      {wallet && updatedAt ? (
        <Text variant="caption" tone="onBrandMuted">
          {t('common.updated', { time: savedAtText(updatedAt) })}
        </Text>
      ) : null}

      {showPending ? (
        <Pressable
          onPress={() => onBeingChecked(latestPending)}
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
        <View style={styles.cardActions}>
          <Button label={t('wallet.card.addMoney')} onPress={onAddMoney} variant="inverse" icon="addMoney" fullWidth={false} />
          <Pressable
            onPress={onHistory}
            accessibilityRole="button"
            accessibilityLabel={t('wallet.card.history')}
            hitSlop={sizes.hitSlop}
            android_ripple={{ color: colors.rippleOnBrand }}
            style={styles.historyLink}
          >
            <Text variant="button" tone="onBrand">
              {t('wallet.card.history')}
            </Text>
            <Icon name="chevron" size={20} tone="onBrand" />
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

/** A big hub row: an icon, a title, a line under it and a chevron (at least 64 dp). */
function HubTile({
  icon,
  title,
  subtitle,
  onPress,
  tone = 'default',
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  tone?: 'default' | 'warning';
}) {
  const warning = tone === 'warning';
  return (
    <Card onPress={onPress} tone={warning ? 'warning' : 'default'} accessibilityLabel={`${title}, ${subtitle}`}>
      <View style={styles.tile}>
        <View style={[styles.tileIcon, warning ? styles.tileIconWarning : null]}>
          <Icon name={icon} size={24} tone={warning ? 'warning' : 'brand'} />
        </View>
        <View style={styles.flex}>
          <Text variant="heading">{title}</Text>
          <Text tone="secondary">{subtitle}</Text>
        </View>
        <Icon name="chevron" size={24} tone="secondary" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  flex: { flex: 1 },
  skeletons: { gap: space.sm, paddingVertical: space.xs },
  cardError: { gap: space.md, paddingVertical: space.sm, alignItems: 'flex-start' },
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
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.lg,
  },
  historyLink: {
    minHeight: sizes.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  cardAction: { marginTop: space.md },
  tiles: { gap: space.md },
  tile: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: sizes.listRow - 2 * space.lg },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconWarning: { backgroundColor: colors.surface },
});
