import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toApiError, type ApiError } from '../../api/errors';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import { ActionLine, Button, EmptyState, QueryBoundary, SkeletonCard, Stepper, Text, space } from '../../ui';
import { DriverScreen, useCallOfficeAction, usePullToRefresh } from './components';
import {
  REFILLS_POLL_MS,
  REFILLS_QUERY_KEY,
  advanceRefill,
  fetchDriverRefill,
  filledOf,
  pickedOf,
  refillQueryKey,
  refillWords,
  stageOf,
  type DriverRefill,
  type RefillStep,
} from './refillModel';
import { StageChip } from './RefillsScreen';

type Nav = NativeStackNavigationProp<DriverStackParams, 'RefillRun'>;

/**
 * One refill (driver spec D14): the title says this step's job, then the refill's one line (data), a
 * stepper on the steps that take a count, and the step's one button:
 *
 * | Status | Title | Control | Footer |
 * |---|---|---|---|
 * | ASSIGNED | Pick up empties at {{store}} | Empties picked up (1 to requested, starts full) | Picked up 3 empties |
 * | EMPTIES_PICKED | Go to {{station}} | – | I've arrived |
 * | AT_STATION | Fill at {{station}} | Cylinders filled (0 to picked, starts full) | Mark 3 filled |
 * | FILLED | Bring them back to {{store}} | "Filled 3 of 3" | Brought back |
 * | RETURNED | Back at {{store}} | "The office will finish this refill." | none |
 * | COMPLETED, CANCELLED | the chip | – | Back to refills |
 *
 * Inc 3 (R10) keeps this screen and swaps the steppers for scans. No money anywhere.
 */
export function RefillRunScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'RefillRun'>>();
  const refillId = params?.refillId ?? '';
  const queryClient = useQueryClient();
  const callOffice = useCallOfficeAction();

  const refill = useQuery<DriverRefill, ApiError>({
    queryKey: refillQueryKey(refillId),
    queryFn: () => fetchDriverRefill(refillId),
    enabled: refillId !== '',
    // Opened from the list: show its row at once, then refresh it.
    initialData: () =>
      queryClient.getQueryData<DriverRefill[]>(REFILLS_QUERY_KEY)?.find((candidate) => candidate.id === refillId),
    initialDataUpdatedAt: () => queryClient.getQueryState(REFILLS_QUERY_KEY)?.dataUpdatedAt,
    refetchInterval: useFocusedInterval(REFILLS_POLL_MS),
  });
  const pull = usePullToRefresh(refill.refetch);

  const advance = useMutation<DriverRefill, ApiError, RefillStep>({
    mutationFn: (step) => advanceRefill(refillId, step),
    onSuccess: (updated) => {
      if (updated?.id) queryClient.setQueryData(refillQueryKey(refillId), updated);
      void queryClient.invalidateQueries({ queryKey: REFILLS_QUERY_KEY });
    },
  });

  // The counts start full and stay where the driver set them, until the step changes.
  const data = refill.data;
  const status = data?.status;
  const [picked, setPicked] = useState<number | null>(null);
  const [filled, setFilled] = useState<number | null>(null);
  const resetAdvance = advance.reset;
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === status) return;
    lastStatus.current = status;
    setPicked(null);
    setFilled(null);
    resetAdvance();
  }, [status, resetAdvance]);

  const requested = Math.max(1, data?.requestedCount ?? 1);
  const pickedCount = Math.min(picked ?? requested, requested);
  const pickedSoFar = data ? pickedOf(data) : 0;
  const filledCount = Math.min(filled ?? pickedSoFar, pickedSoFar);
  const sending = t('driver.steps.sending');
  const notFound = data === undefined && refill.isError && toApiError(refill.error).code === 'NOT_FOUND';
  const backToRefills = (
    <Button label={t('driver.refills.back')} onPress={() => navigation.navigate('Refills')} testID="refill.back" />
  );

  let action: ReactNode = null;
  switch (status) {
    case 'ASSIGNED':
      action = (
        <Button
          label={t('driver.refills.markPicked', { count: pickedCount })}
          loadingLabel={sending}
          loading={advance.isPending}
          onPress={() => advance.mutate({ endpoint: 'picked-empties', body: { emptyCount: pickedCount } })}
          testID="refill.picked"
        />
      );
      break;
    case 'EMPTIES_PICKED':
      action = (
        <Button
          label={t('driver.steps.drive.arrive')}
          loadingLabel={sending}
          loading={advance.isPending}
          icon="map"
          onPress={() => advance.mutate({ endpoint: 'at-station' })}
          testID="refill.atStation"
        />
      );
      break;
    case 'AT_STATION':
      action = (
        <Button
          label={t('driver.refills.markFilled', { count: filledCount })}
          loadingLabel={sending}
          loading={advance.isPending}
          onPress={() => advance.mutate({ endpoint: 'filled', body: { filledCount } })}
          testID="refill.filled"
        />
      );
      break;
    case 'FILLED':
      action = (
        <Button
          label={t('driver.refills.markReturned')}
          loadingLabel={sending}
          loading={advance.isPending}
          onPress={() => advance.mutate({ endpoint: 'returned' })}
          testID="refill.returned"
        />
      );
      break;
    case 'COMPLETED':
    case 'CANCELLED':
    case 'FAILED':
      action = backToRefills;
      break;
    default:
      action = null;
  }
  const footer = notFound ? (
    backToRefills
  ) : action ? (
    <>
      <ActionLine error={advance.error} />
      {action}
    </>
  ) : undefined;

  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
      {notFound ? (
        <EmptyState icon="cylinder" title={t('errors.NOT_FOUND')} />
      ) : (
        <QueryBoundary query={refill} skeleton={<SkeletonCard lines={2} />} errorAction={callOffice}>
          {(view) => {
            const words = refillWords(view, t);
            const line = (
              <Text variant="bodyStrong" tabular>
                {words.title}
              </Text>
            );
            switch (view.status) {
              case 'ASSIGNED':
                return (
                  <RefillStepView title={t('driver.refills.step.pickUp', { store: words.store })} line={line}>
                    <Stepper
                      label={t('driver.refills.picked')}
                      helper={t('driver.refills.pickedHelp', { count: requested })}
                      value={pickedCount}
                      min={1}
                      max={requested}
                      onChange={setPicked}
                      disabled={advance.isPending}
                      testID="refill.pickedStepper"
                    />
                  </RefillStepView>
                );
              case 'EMPTIES_PICKED':
                return (
                  <RefillStepView title={t('driver.refills.step.goStation', { station: words.station })} line={line} />
                );
              case 'AT_STATION':
                return (
                  <RefillStepView title={t('driver.refills.step.fill', { station: words.station })} line={line}>
                    <Stepper
                      label={t('driver.refills.filled')}
                      helper={t('driver.refills.filledHelp', { count: pickedSoFar })}
                      value={filledCount}
                      min={0}
                      max={pickedSoFar}
                      onChange={setFilled}
                      disabled={advance.isPending}
                      testID="refill.filledStepper"
                    />
                  </RefillStepView>
                );
              case 'FILLED':
                return (
                  <RefillStepView title={t('driver.refills.step.bringBack', { store: words.store })} line={line}>
                    <Text tabular>
                      {t('driver.refills.filledOf', { filled: filledOf(view), count: pickedOf(view) })}
                    </Text>
                  </RefillStepView>
                );
              case 'RETURNED':
                return (
                  <RefillStepView title={t('driver.refills.step.back', { store: words.store })} line={line}>
                    <Text>{t('driver.refills.returnedNote')}</Text>
                  </RefillStepView>
                );
              default:
                // Done, cancelled, or not yet the driver's: the chip says which.
                return (
                  <View style={styles.stack}>
                    <StageChip stage={stageOf(view)} />
                    {line}
                  </View>
                );
            }
          }}
        </QueryBoundary>
      )}
    </DriverScreen>
  );
}

/** A refill step: the job as the title, the refill's line, then its control or note. */
function RefillStepView({ title, line, children }: { title: string; line: ReactNode; children?: ReactNode }) {
  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text variant="title">{title}</Text>
        {line}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xl },
  heading: { gap: space.xs },
});
