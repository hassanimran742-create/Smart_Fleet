import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CheckingHours, DistributorHomeDto, PaymentDto, TopupInfoDto } from '@smartfleet/shared-types';
import { formatRs } from '@smartfleet/shared-utils';
import { isApiError, type ApiError } from '../../../api/errors';
import { POLL_MS, qk } from '../../../api/keys';
import { useAppConfig, useOfficeContact } from '../../../hooks/useAppConfig';
import { useFocusedInterval } from '../../../hooks/useFocusedInterval';
import { formatWhenText } from '../../../i18n';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  MoneyText,
  QueryBoundary,
  Screen,
  SkeletonCard,
  space,
  StatusChip,
  Text,
  Timeline,
  type TimelineItem,
} from '../../../ui';
import { fetchHome, fetchTopup, fetchTopupInfo } from '../shared/api';
import { isWithinCheckingHours, paisaOrZero } from '../shared/format';
import { useShopNavigation, useShopRoute } from '../shared/navigation';
import { usePullRefresh } from '../shared/refresh';

/**
 * S6 Add money: Status (agreed sample screen 5). The amount, a timeline Sent → Being checked → Added
 * to your balance, the credited amount when the bank's differed, or the reason it wasn't added with
 * "Call office" and "Try again" (a new request, prefilled). Polls every 30 seconds while it is being
 * checked and the screen is open.
 */
export function TopupStatusScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const { params } = useShopRoute<'TopupStatus'>();
  const id = params.id;

  // Polls only while it is being checked, the screen is focused and the app is in the foreground.
  const poll = useFocusedInterval(POLL_MS.topupBeingChecked);
  const topup = useQuery<PaymentDto, ApiError>({
    queryKey: qk.topups.byId(id),
    queryFn: () => fetchTopup(id),
    refetchInterval: (query) => (query.state.data?.stage === 'BEING_CHECKED' ? poll : false),
  });
  const stage = topup.data?.stage;
  const home = useQuery<DistributorHomeDto, ApiError>({ queryKey: qk.home, queryFn: fetchHome, enabled: stage === 'ADDED' });
  // The checking hours, fresh from the office's settings while it is being checked (the app config
  // copy can be 5 minutes old); the app config's hours stand in until it answers.
  const info = useQuery<TopupInfoDto, ApiError>({
    queryKey: qk.topups.info,
    queryFn: fetchTopupInfo,
    enabled: stage === 'BEING_CHECKED',
  });
  const refetchTopup = topup.refetch;
  const refetchInfo = info.refetch;
  const refreshAll = useCallback(
    () => Promise.all([refetchTopup(), stage === 'BEING_CHECKED' ? refetchInfo() : undefined]),
    [refetchTopup, refetchInfo, stage],
  );
  const pull = usePullRefresh(refreshAll);

  // Once it is added (or refused), the wallet and the lists change: refresh them once.
  const settledStage = useRef(stage);
  useEffect(() => {
    if (!stage || settledStage.current === stage) return;
    const wasChecking = settledStage.current === 'BEING_CHECKED';
    settledStage.current = stage;
    if (wasChecking && stage !== 'BEING_CHECKED') {
      void queryClient.invalidateQueries({ queryKey: qk.home });
      void queryClient.invalidateQueries({ queryKey: qk.topups.mine });
      void queryClient.invalidateQueries({ queryKey: qk.wallet.statementAll });
    }
  }, [stage, queryClient]);

  useEffect(() => {
    navigation.setOptions({
      title: topup.data ? t('topup.status.title', { code: topup.data.shortCode }) : t('topup.status.titleLoading'),
    });
  }, [navigation, t, topup.data]);

  const notFound = !topup.data && isApiError(topup.error) && topup.error.status === 404;
  // Home with a NAVIGATE, not popToTop: form guards ask only when the person leaves by hand, so a New
  // order left under this screen (Add money from "Check and place") closes without "Leave without
  // saving?". Its draft is dropped, which is fine: it can't be placed until this top-up is added.
  const backHome = () => navigation.navigate('Home');
  const tryAgain = () => {
    const p = topup.data;
    if (!p) return;
    navigation.replace('TopupAmount', {
      amountPaisa: p.amountPaisa,
      payerName: p.payerName ?? undefined,
      payerChannel: p.payerChannel ?? undefined,
    });
  };

  return (
    <Screen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        stage === 'NOT_ADDED' ? (
          <Button label={t('topup.status.tryAgain')} onPress={tryAgain} size="lg" />
        ) : (
          <Button label={t('topup.status.backHome')} onPress={backHome} size="lg" />
        )
      }
    >
      {notFound ? (
        <EmptyState icon="receipt" title={t('topup.status.notFound')} />
      ) : (
        <QueryBoundary query={topup} skeleton={<SkeletonCard lines={4} />}>
          {(payment) => (
            <StatusBody
              payment={payment}
              balancePaisa={home.data?.wallet.balancePaisa ?? null}
              checkingHours={info.data?.checkingHours ?? null}
            />
          )}
        </QueryBoundary>
      )}
    </Screen>
  );
}

function StatusBody({
  payment,
  balancePaisa,
  checkingHours,
}: {
  payment: PaymentDto;
  balancePaisa: string | null;
  checkingHours: CheckingHours | null;
}) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const { config } = useAppConfig();
  const hours = checkingHours ?? config.topup.checkingHours;
  const { stage } = payment;

  const checkingDetail = isWithinCheckingHours(hours, config.day.timezone)
    ? t('topup.status.usually', { from: hours.from, to: hours.to })
    : t('topup.status.startsAt', { from: hours.from });

  const items: TimelineItem[] = [
    { key: 'sent', label: t('topup.status.sent'), time: formatWhenText(payment.createdAt), state: 'done' },
    stage === 'NOT_ADDED'
      ? {
          key: 'checked',
          label: t('topup.status.notAdded'),
          time: payment.reviewedAt ? formatWhenText(payment.reviewedAt) : undefined,
          state: 'problem',
        }
      : {
          key: 'checked',
          label: t('topup.status.beingChecked'),
          detail: stage === 'BEING_CHECKED' ? checkingDetail : undefined,
          state: stage === 'BEING_CHECKED' ? 'current' : 'done',
        },
  ];
  if (stage !== 'NOT_ADDED') {
    items.push({
      key: 'added',
      label: t('topup.status.addedStep'),
      time: stage === 'ADDED' && payment.reviewedAt ? formatWhenText(payment.reviewedAt) : undefined,
      state: stage === 'ADDED' ? 'done' : 'todo',
    });
  }

  const credited = payment.creditedPaisa ?? payment.amountPaisa;
  const differs = stage === 'ADDED' && paisaOrZero(credited) !== paisaOrZero(payment.amountPaisa);

  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        <MoneyText paisa={payment.amountPaisa} variant="display" />
        <View style={styles.headerRow}>
          <Text tone="secondary">{payment.shortCode}</Text>
          <StatusChip kind="topup" value={stage} />
        </View>
      </View>

      {stage === 'ADDED' ? (
        <Card tone="success">
          <View style={styles.row} accessibilityLiveRegion="polite">
            <Icon name="ok" size={24} tone="success" />
            <View style={styles.flex}>
              {differs ? (
                <>
                  <Text variant="bodyStrong">
                    {t('topup.status.addedDifferent', { credited: formatRs(credited), amount: formatRs(payment.amountPaisa) })}
                  </Text>
                  {balancePaisa !== null ? <Text>{t('topup.status.balanceNow', { balance: formatRs(balancePaisa) })}</Text> : null}
                </>
              ) : balancePaisa !== null ? (
                <Text variant="bodyStrong">
                  {t('topup.status.added', { amount: formatRs(credited), balance: formatRs(balancePaisa) })}
                </Text>
              ) : (
                <Text variant="bodyStrong">{t('topup.status.addedNoBalance', { amount: formatRs(credited) })}</Text>
              )}
            </View>
          </View>
          {differs && office.phone ? (
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

      {stage === 'NOT_ADDED' ? (
        <Card tone="danger">
          <View style={styles.row} accessibilityRole="alert">
            <Icon name="error" size={24} tone="danger" />
            <View style={styles.flex}>
              <Text variant="bodyStrong">{t(`topup.reason.${payment.rejectReasonCode ?? 'OTHER'}`)}</Text>
              {payment.rejectNote ? <Text>{t('topup.status.officeNote', { note: payment.rejectNote })}</Text> : null}
            </View>
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

      <Card>
        <Timeline items={items} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  header: { gap: space.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1, gap: space.xs },
  cardAction: { marginTop: space.md },
});
