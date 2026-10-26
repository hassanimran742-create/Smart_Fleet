import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CheckingHours, DistributorHomeDto, PaymentDto, TopupInfoDto } from '@smartfleet/shared-types';
import { formatClock, formatRs } from '@smartfleet/shared-utils';
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
import { tellUsAgain, useShopNavigation, useShopRoute } from '../shared/navigation';
import { usePullRefresh } from '../shared/refresh';

/** The money that counts: what was added once added, otherwise what the shop said it paid. */
function shownAmount(payment: PaymentDto): string {
  return payment.stage === 'ADDED' && payment.creditedPaisa ? payment.creditedPaisa : payment.amountPaisa;
}

/** True when the office added a different amount than the shop said it paid. */
function addedDifferent(payment: PaymentDto): boolean {
  return (
    payment.stage === 'ADDED' && !!payment.creditedPaisa && paisaOrZero(payment.creditedPaisa) !== paisaOrZero(payment.amountPaisa)
  );
}

/**
 * S6 Top-up status (shop spec §I): the amount big, the chip (Being checked, Added, Not added), then
 * by stage: the timeline while it is being checked; "Balance now" once added; the reason and the
 * office's note when it wasn't. "Tell us again" opens Tell us you paid, prefilled, so nothing asks
 * the shop to pay twice. Polls every 30 seconds while it is being checked and the screen is open.
 */
export function TopupStatusScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const office = useOfficeContact();
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
  const tellAgain = () => {
    const p = topup.data;
    if (!p) return;
    tellUsAgain(navigation, {
      amountPaisa: p.amountPaisa,
      payerName: p.payerName ?? undefined,
      // "Other" is no longer offered (DECIDED): such a request comes back as Easypaisa.
      payerChannel: p.payerChannel === 'BANK_APP' ? 'BANK_APP' : 'EASYPAISA_APP',
    });
  };
  const callOffice = office.phone ? (
    <Button label={t('common.actions.callOffice')} onPress={office.call} size="lg" icon="call" variant="secondary" />
  ) : null;

  return (
    <Screen
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={
        stage === 'NOT_ADDED' ? (
          <>
            {callOffice}
            <Button label={t('topup.status.tellAgain')} onPress={tellAgain} size="lg" />
          </>
        ) : (
          <>
            {topup.data && addedDifferent(topup.data) ? callOffice : null}
            <Button label={t('topup.status.backHome')} onPress={backHome} size="lg" />
          </>
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
  const { config } = useAppConfig();
  const hours = checkingHours ?? config.topup.checkingHours;
  const { stage } = payment;
  const steps: TimelineItem[] = [
    { key: 'sent', label: t('topup.status.sent'), time: formatWhenText(payment.createdAt), state: 'done' },
    {
      key: 'checking',
      label: t('topup.status.beingChecked'),
      detail: isWithinCheckingHours(hours, config.day.timezone)
        ? t('topup.status.usually', { from: formatClock(hours.from), to: formatClock(hours.to) })
        : t('topup.status.startsAt', { from: formatClock(hours.from) }),
      state: 'current',
    },
    { key: 'added', label: t('topup.status.addedStep'), state: 'todo' },
  ];

  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        <MoneyText paisa={shownAmount(payment)} variant="display" numberOfLines={1} />
        <StatusChip kind="topup" value={stage} />
      </View>

      {stage === 'BEING_CHECKED' ? (
        <Card>
          <Timeline items={steps} />
        </Card>
      ) : null}

      {stage === 'ADDED' ? (
        <Card tone="success">
          <View style={styles.added} accessibilityLiveRegion="polite">
            {balancePaisa !== null ? (
              <>
                <Text variant="label" tone="secondary">
                  {t('topup.status.balanceNow')}
                </Text>
                <MoneyText paisa={balancePaisa} variant="title" numberOfLines={1} />
              </>
            ) : null}
            {payment.reviewedAt ? (
              <Text variant="caption" tone="secondary">
                {t('topup.status.addedAt', { when: formatWhenText(payment.reviewedAt) })}
              </Text>
            ) : null}
            {addedDifferent(payment) ? (
              <View style={styles.row}>
                <Icon name="warn" size={20} tone="warning" />
                <Text tone="warning" style={styles.flex}>
                  {t('topup.status.addedDifferent', { amount: formatRs(payment.amountPaisa) })}
                </Text>
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      {stage === 'NOT_ADDED' ? (
        <Card tone="danger">
          <View style={styles.row} accessibilityRole="alert">
            <Icon name="error" size={24} tone="danger" />
            <View style={styles.reason}>
              <Text variant="bodyStrong">{t(`topup.reason.${payment.rejectReasonCode ?? 'OTHER'}`)}</Text>
              {payment.rejectNote ? <Text>{t('topup.status.officeNote', { note: payment.rejectNote })}</Text> : null}
            </View>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  header: { gap: space.sm, alignItems: 'flex-start' },
  added: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  reason: { flex: 1, gap: space.xs },
  flex: { flex: 1 },
});
