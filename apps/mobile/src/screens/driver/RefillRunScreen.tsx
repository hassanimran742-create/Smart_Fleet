import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RefillAdvanceTarget, RefillScanPhase } from '@smartfleet/shared-types';
import { toApiError, type ApiError } from '../../api/errors';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import { ActionLine, Button, CountBar, EmptyState, QueryBoundary, SkeletonCard, Text, space } from '../../ui';
import { ScanPanel, answerFromResult, playScanFeedback, type ScanRead, type ScanReply } from '../../ui/scan';
import { DriverScreen, FooterReason, NoticeStrip, StepFrame, useCallOfficeAction, usePullToRefresh } from './components';
import {
  REFILLS_POLL_MS,
  REFILLS_QUERY_KEY,
  REFILL_UNLOAD_POLL_MS,
  advanceRefill,
  bringBackUnfilled,
  countsOf,
  fetchDriverRefill,
  postRefillScan,
  refillQueryKey,
  refillRefusalCounts,
  refillStepOf,
  refillWords,
  stageOf,
  useBroughtBackUnfilled,
  withRefillCounts,
  type DriverRefill,
} from './refillModel';
import { StageChip } from './RefillsScreen';

type Nav = NativeStackNavigationProp<DriverStackParams, 'RefillRun'>;

/**
 * One refill on scans (driver spec R10; Inc 2/3 spec §4.5; UX_MOBILE §8.2), three steps on one screen,
 * header "Refill", each with its title and the refill's one line ("2 × 11.8 kg · Ahmed Gas"):
 *
 * | Step | Title | Count | Footer |
 * |---|---|---|---|
 * | 1 Pick up (ASSIGNED) | Pick up empties at {{store}} | {{picked}} of {{requested}} picked up | Done picking up, off at 0 with "Scan a cylinder first." |
 * | 2 Fill (EMPTIES_PICKED, AT_STATION) | Fill at {{station}} | {{filled}} of {{picked}} filled | Done filling, off at 0; "Bring back unfilled" while none is filled |
 * | 3 Unload (FILLED) | Unload at {{store}} | {{received}} of {{picked}} unloaded (polls 5 s) | none while the shop scans |
 *
 * When the shop's last receive scan completes the refill: "Refill done" and "Back to refills". Every
 * refill step is a scan (ADR-16): a full cylinder is refused with the catalogue's words. No money.
 */
export function RefillRunScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'RefillRun'>>();
  const refillId = params?.refillId ?? '';
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const callOffice = useCallOfficeAction();
  const { config } = useAppConfig();
  const unfilled = useBroughtBackUnfilled(refillId);

  const cached = queryClient.getQueryData<DriverRefill>(refillQueryKey(refillId));
  const unloading = cached ? refillStepOf(cached, unfilled) === 'UNLOAD' : false;
  const refill = useQuery<DriverRefill, ApiError>({
    queryKey: refillQueryKey(refillId),
    queryFn: () => fetchDriverRefill(refillId),
    enabled: refillId !== '',
    // Opened from the list: show its row at once, then refresh it.
    initialData: () =>
      queryClient.getQueryData<DriverRefill[]>(REFILLS_QUERY_KEY)?.find((candidate) => candidate.id === refillId),
    initialDataUpdatedAt: () => queryClient.getQueryState(REFILLS_QUERY_KEY)?.dataUpdatedAt,
    refetchInterval: useFocusedInterval(unloading ? REFILL_UNLOAD_POLL_MS : REFILLS_POLL_MS),
  });
  const refetch = refill.refetch;
  const pull = usePullToRefresh(refetch);

  const data = refill.data;
  const step = data ? refillStepOf(data, unfilled) : null;
  const counts = data ? countsOf(data) : null;

  // The shop's last receive finishes the refill: the long buzz and "Refill done".
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current === 'UNLOAD' && step === 'DONE') playScanFeedback('complete');
    lastStep.current = step;
  }, [step]);

  const setRefill = (update: (old: DriverRefill | undefined) => DriverRefill | undefined) =>
    queryClient.setQueryData<DriverRefill>(refillQueryKey(refillId), update);

  const scanWith = useCallback(
    (phase: RefillScanPhase) =>
      async (read: ScanRead): Promise<ScanReply> => {
        try {
          const result = await postRefillScan(refillId, phase, read);
          void queryClient.cancelQueries({ queryKey: refillQueryKey(refillId) });
          queryClient.setQueryData<DriverRefill>(refillQueryKey(refillId), (old) => withRefillCounts(old, result.refill));
          return answerFromResult(result);
        } catch (thrown) {
          const progress = refillRefusalCounts(thrown);
          if (progress) {
            void queryClient.cancelQueries({ queryKey: refillQueryKey(refillId) });
            queryClient.setQueryData<DriverRefill>(refillQueryKey(refillId), (old) => withRefillCounts(old, progress));
          }
          // Another step than this phone thought: read the refill again, and the screen moves there.
          if (toApiError(thrown).code === 'REFILL_WRONG_STEP') void refetch();
          throw thrown;
        }
      },
    [queryClient, refillId, refetch],
  );
  const onPickUp = useCallback((read: ScanRead) => scanWith('PICKUP')(read), [scanWith]);
  const onFill = useCallback((read: ScanRead) => scanWith('FILL')(read), [scanWith]);

  const advance = useMutation<DriverRefill, ApiError, RefillAdvanceTarget>({
    mutationFn: (to) => advanceRefill(refillId, to),
    onSuccess: (updated) => {
      if (updated?.id) setRefill(() => updated);
      void queryClient.invalidateQueries({ queryKey: REFILLS_QUERY_KEY });
    },
    onError: (error) => {
      if (error.code === 'REFILL_WRONG_STEP') void refetch();
    },
  });

  // A new step starts clean: the last step's error line belongs to that step.
  const resetAdvance = advance.reset;
  useEffect(() => {
    resetAdvance();
  }, [step, resetAdvance]);

  const notFound = data === undefined && refill.isError && toApiError(refill.error).code === 'NOT_FOUND';
  const backToRefills = (
    <Button label={t('driver.refills.back')} onPress={() => navigation.navigate('Refills')} testID="refill.back" />
  );
  const sending = t('driver.steps.sending');

  let footer: ReactNode;
  if (notFound) footer = backToRefills;
  else if (data && counts && step === 'PICKUP') {
    footer = (
      <>
        {advance.error ? (
          <ActionLine error={advance.error} />
        ) : counts.picked === 0 ? (
          <FooterReason text={t('driver.refills.run.needOne')} testID="refill.needOne" />
        ) : null}
        <Button
          label={t('driver.refills.run.pickupDone')}
          loadingLabel={sending}
          loading={advance.isPending}
          disabled={counts.picked === 0}
          onPress={() => advance.mutate('EMPTIES_PICKED')}
          testID="refill.pickupDone"
        />
      </>
    );
  } else if (data && counts && step === 'FILL') {
    footer = (
      <>
        {advance.error ? (
          <ActionLine error={advance.error} />
        ) : counts.filled === 0 ? (
          <FooterReason text={t('driver.refills.run.needOne')} testID="refill.needOne" />
        ) : null}
        <Button
          label={t('driver.refills.run.fillDone')}
          loadingLabel={sending}
          loading={advance.isPending}
          disabled={counts.filled === 0}
          onPress={() => advance.mutate('FILLED')}
          testID="refill.fillDone"
        />
      </>
    );
  } else if (step === 'DONE' || step === 'CANCELLED' || step === 'WAITING') {
    footer = backToRefills;
  }

  return (
    <DriverScreen key={step ?? 'none'} refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
      {notFound ? (
        <EmptyState icon="cylinder" title={t('errors.NOT_FOUND')} />
      ) : (
        <QueryBoundary query={refill} skeleton={<SkeletonCard lines={2} />} errorAction={callOffice} offlineAction={callOffice}>
          {(view) => {
            const words = refillWords(view, t);
            const now = countsOf(view);
            switch (refillStepOf(view, unfilled)) {
              case 'PICKUP':
                return (
                  <StepFrame
                    icon="store"
                    title={t('driver.refills.step.pickUp', { store: words.store })}
                    subtitle={words.title}
                    count={
                      <CountBar count={now.picked} total={now.requested} verb={t('scan.verb.REFILL_PICKUP')} testID="refill.count" />
                    }
                    scan={
                      <ScanPanel
                        key="REFILL_PICKUP"
                        step="REFILL_PICKUP"
                        onScan={onPickUp}
                        active={focused}
                        complete={now.requested > 0 ? now.picked >= now.requested : undefined}
                        allowTyped={config.features.typedCylinderNumber}
                        testID="refill.scan"
                      />
                    }
                    testID="refill.pickup"
                  />
                );
              case 'FILL':
                return (
                  <StepFrame
                    icon="cylinder"
                    title={t('driver.refills.step.fill', { station: words.station })}
                    subtitle={words.title}
                    count={<CountBar count={now.filled} total={now.picked} verb={t('scan.verb.REFILL_FILL')} testID="refill.count" />}
                    scan={
                      <ScanPanel
                        key="REFILL_FILL"
                        step="REFILL_FILL"
                        onScan={onFill}
                        active={focused}
                        complete={now.picked > 0 ? now.filled >= now.picked : undefined}
                        allowTyped={config.features.typedCylinderNumber}
                        testID="refill.scan"
                      />
                    }
                    rare={
                      now.filled === 0 ? (
                        <Button
                          label={t('driver.refills.run.noneFilled')}
                          icon="store"
                          variant="ghost"
                          onPress={() => bringBackUnfilled(view.id)}
                          testID="refill.noneFilled"
                        />
                      ) : null
                    }
                    testID="refill.fill"
                  />
                );
              case 'UNLOAD':
              case 'DONE':
                return (
                  <StepFrame
                    icon="store"
                    title={t('driver.trip.unloadAt', { store: words.store })}
                    subtitle={words.title}
                    control={
                      refillStepOf(view, unfilled) === 'UNLOAD' ? (
                        <Text testID="refill.unloadHint">{t('driver.unload.hint')}</Text>
                      ) : null
                    }
                    count={
                      refillStepOf(view, unfilled) === 'DONE' ? (
                        <NoticeStrip tone="success" icon="ok" message={t('driver.refills.run.refillDone')} testID="refill.done" />
                      ) : (
                        <CountBar count={now.received} total={now.picked} verb={t('scan.verb.UNLOAD')} testID="refill.count" />
                      )
                    }
                    testID="refill.unload"
                  />
                );
              default:
                // Cancelled, or not yet the driver's: the chip says which.
                return (
                  <View style={styles.stack}>
                    <StageChip stage={stageOf(view)} />
                    <Text variant="bodyStrong" tabular>
                      {words.title}
                    </Text>
                  </View>
                );
            }
          }}
        </QueryBoundary>
      )}
    </DriverScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xl },
});
