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
  fetchDriverRefills,
  isRefillOpen,
  refillWords,
  stageOf,
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
 * Refills (driver spec D13): the open refills, oldest first, one row each ("2 × 11.8 kg · Ahmed
 * Gas" and the next job); a tap opens that refill, which has the one button. Then "Done today: 2".
 * Drivers don't create refills, so there is no footer. No money anywhere.
 */
export function RefillsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { config } = useAppConfig();
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
          const open = list.filter(isRefillOpen).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
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
                    <ListRow
                      key={refill.id}
                      title={refillWords(refill, t).title}
                      leadingIcon="cylinder"
                      below={<StageChip stage={stageOf(refill)} />}
                      chevron
                      onPress={() => navigation.navigate('RefillRun', { refillId: refill.id })}
                      style={styles.row}
                      testID={`refills.row.${refill.id}`}
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
