import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { RefillStage } from '@smartfleet/shared-types';
import type { ApiError } from '../../api/errors';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
  EmptyState,
  ListRow,
  QueryBoundary,
  SkeletonList,
  StatusChip,
  Text,
  colors,
  layout,
  radius,
  resolveStatus,
  space,
} from '../../ui';
import { DriverScreen, usePullToRefresh } from './components';
import {
  REFILLS_POLL_MS,
  REFILLS_QUERY_KEY,
  driverStageOf,
  fetchDriverRefills,
  openRefillsOf,
  refillWords,
  useBroughtBackUnfilledIds,
  type DriverRefill,
} from './refillModel';
import { businessDayOf } from './tripModel';

type Nav = NativeStackNavigationProp<DriverStackParams, 'Refills'>;

/**
 * A refill's chip in the driver's words, the next job ("Pick up empties", "Go to the station"), with
 * the shared refill tones and icons (rulebook §4.2: waiting is amber, back at store is blue, only done
 * is green).
 */
export function StageChip({ stage }: { stage: RefillStage }) {
  const { t } = useTranslation();
  const look = resolveStatus('refill', stage, t);
  return (
    <StatusChip tone={look?.tone ?? 'neutral'} icon={look?.icon ?? null} label={t(`driver.refills.stage.${stage}`)} />
  );
}

/**
 * One open refill as a row (the Refills list and Today): "2 × 11.8 kg · Ahmed Gas" (on Today "Refill ·
 * 2 × 11.8 kg · Ahmed Gas", among the trips), the driver's next job as the chip under it (never beside
 * it, so the line keeps the row's width), and a chevron; a tap opens the refill. The chip is the run's
 * own step: a refill brought back unfilled reads "Bring them back" (review23 ux-04).
 */
export function RefillRow({
  refill,
  broughtBackUnfilled,
  onToday = false,
  onPress,
}: {
  refill: DriverRefill;
  broughtBackUnfilled: boolean;
  /** Today names it a refill, beside the trips. */
  onToday?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const line = refillWords(refill, t).title;
  return (
    <ListRow
      title={onToday ? t('driver.home.refillRow', { line }) : line}
      leadingIcon="cylinder"
      below={<StageChip stage={driverStageOf(refill, broughtBackUnfilled)} />}
      chevron
      onPress={onPress}
      style={styles.row}
      testID={onToday ? `home.refill.${refill.id}` : `refills.row.${refill.id}`}
    />
  );
}

/**
 * Refills (driver spec D13): the open refills, oldest first, one row each ("2 × 11.8 kg · Ahmed
 * Gas" and the next job, the same step the refill's own screen shows); a tap opens that refill, which
 * has the one button. Then "Done today: 2". Drivers don't create refills, so there is no footer. No
 * money anywhere.
 */
export function RefillsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { config } = useAppConfig();
  const unfilled = useBroughtBackUnfilledIds();
  const refills = useQuery<DriverRefill[], ApiError>({
    queryKey: REFILLS_QUERY_KEY,
    queryFn: fetchDriverRefills,
    refetchInterval: useFocusedInterval(REFILLS_POLL_MS),
  });
  const pull = usePullToRefresh(refills.refetch);

  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <QueryBoundary query={refills} skeleton={<SkeletonList rows={2} />}>
        {(list) => {
          const open = openRefillsOf(list);
          const today = businessDayOf(Date.now(), config.day);
          const doneToday = list.filter(
            (refill) =>
              refill.status === 'COMPLETED' &&
              refill.completedAt &&
              businessDayOf(refill.completedAt, config.day) === today,
          ).length;
          return (
            <View style={styles.stack}>
              {open.length === 0 ? (
                <EmptyState
                  icon="cylinder"
                  title={t('driver.refills.empty.title')}
                  body={t('driver.refills.empty.body')}
                />
              ) : (
                <View style={styles.list}>
                  {open.map((refill) => (
                    <RefillRow
                      key={refill.id}
                      refill={refill}
                      broughtBackUnfilled={unfilled[refill.id] === true}
                      onPress={() => navigation.navigate('RefillRun', { refillId: refill.id })}
                    />
                  ))}
                </View>
              )}
              {doneToday > 0 ? (
                <Text variant="bodyStrong" tabular testID="refills.doneToday">
                  {t('driver.refills.doneToday', { count: doneToday })}
                </Text>
              ) : null}
            </View>
          );
        }}
      </QueryBoundary>
    </DriverScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.cardGap },
  list: { gap: space.sm },
  row: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
});
