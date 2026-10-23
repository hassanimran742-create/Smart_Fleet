import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FillingOrderDto, FillingOrderStatus, RefillStage } from '@smartfleet/shared-types';
import { deriveRefillStage, legacyRefillCounts } from '@smartfleet/shared-utils';
import { api } from '../../api/client';
import type { ApiError } from '../../api/errors';
import { useFocusedInterval } from '../../hooks/useFocusedInterval';
import { formatWhenText } from '../../i18n';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  QueryBoundary,
  SkeletonList,
  StatusChip,
  Stepper,
  Text,
  layout,
  space,
  type ChipTone,
  type IconName,
} from '../../ui';
import { DriverScreen, usePullToRefresh } from './components';

/**
 * A refill on `GET /filling-orders/driver/mine` (API_CONTRACT §7.11). `stage` and `counts` come from
 * Inc 1 servers on; older servers send only the legacy fields, so both are derived when missing.
 * `distributor` and `pickupStore` are the legacy includes the installed app reads.
 */
type DriverRefill = Pick<FillingOrderDto, 'id' | 'status' | 'requestedCount'> &
  Partial<Pick<FillingOrderDto, 'stage' | 'counts' | 'sizeLabel' | 'fillingStation' | 'pickedUpEmptyCount' | 'filledCount' | 'createdAt' | 'completedAt'>> & {
    cylinderType?: { code?: string | null; name?: string | null } | null;
    distributor?: { businessName?: string | null } | null;
    pickupStore?: { name?: string | null } | null;
  };

const REFILLS_QUERY_KEY = ['driver', 'refills'] as const;
const REFILLS_POLL_MS = 15_000;
const FINISHED_SHOWN = 10;
const FINISHED: readonly FillingOrderStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];

/** Each refill stage's chip, in the driver's words (`driver.refills.stage.*`). */
const STAGE_LOOK: Record<RefillStage, { tone: ChipTone; icon: IconName | null }> = {
  NEEDS_DRIVER: { tone: 'neutral', icon: 'checking' },
  DRIVER_ASSIGNED: { tone: 'brand', icon: 'store' },
  PICKING_UP: { tone: 'brand', icon: 'store' },
  PICKED_UP: { tone: 'brand', icon: 'truck' },
  AT_STATION: { tone: 'brand', icon: 'cylinder' },
  COMING_BACK: { tone: 'brand', icon: 'truck' },
  BACK_AT_STORE: { tone: 'success', icon: 'store' },
  DONE: { tone: 'success', icon: 'ok' },
  CANCELLED: { tone: 'neutral', icon: null },
};

async function fetchDriverRefills(): Promise<DriverRefill[]> {
  const { data } = await api.get<DriverRefill[]>('/filling-orders/driver/mine');
  return Array.isArray(data) ? data : [];
}

function stageOf(refill: DriverRefill): RefillStage {
  if (refill.stage) return refill.stage;
  return deriveRefillStage({ status: refill.status, counts: legacyRefillCounts(refill) });
}

function pickedOf(refill: DriverRefill): number {
  return refill.counts?.picked ?? refill.pickedUpEmptyCount ?? 0;
}

function filledOf(refill: DriverRefill): number {
  return refill.counts?.filled ?? refill.filledCount ?? 0;
}

/** The driver's refill step: the four PATCH routes of the assigned driver (no money). */
type RefillStep =
  | { endpoint: 'picked-empties'; body: { emptyCount: number } }
  | { endpoint: 'at-station' }
  | { endpoint: 'filled'; body: { filledCount: number } }
  | { endpoint: 'returned' };

/**
 * Refill runs (UX_MOBILE §5 copy fix; RefillRunScreen replaces it in Inc 3): pick up empties at the
 * shop's store, fill at the station, bring them back. Counts are chosen with a stepper inside the
 * allowed range. A refusal shows inline on the run's card. No money anywhere.
 */
export function DriverFillingOrdersScreen() {
  const { t } = useTranslation();
  const refills = useQuery<DriverRefill[], ApiError>({
    queryKey: REFILLS_QUERY_KEY,
    queryFn: fetchDriverRefills,
    refetchInterval: useFocusedInterval(REFILLS_POLL_MS),
  });
  const pull = usePullToRefresh(refills.refetch);

  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <QueryBoundary
        query={refills}
        skeleton={<SkeletonList rows={2} />}
        isEmpty={(list) => list.length === 0}
        empty={<EmptyState icon="cylinder" title={t('driver.refills.empty.title')} body={t('driver.refills.empty.body')} />}
      >
        {(list) => <RefillLists refills={list} />}
      </QueryBoundary>
    </DriverScreen>
  );
}

function RefillLists({ refills }: { refills: readonly DriverRefill[] }) {
  const { t } = useTranslation();
  const open = refills.filter((refill) => !FINISHED.includes(refill.status));
  const finished = refills.filter((refill) => FINISHED.includes(refill.status)).slice(0, FINISHED_SHOWN);

  return (
    <View style={styles.stack}>
      {open.length > 0 ? (
        <View style={styles.section}>
          <Text variant="heading">{t('driver.refills.openRuns')}</Text>
          {open.map((refill, index) => (
            <OpenRun key={refill.id} refill={refill} main={index === 0} />
          ))}
        </View>
      ) : (
        <EmptyState icon="cylinder" title={t('driver.refills.empty.title')} body={t('driver.refills.empty.body')} />
      )}
      {finished.length > 0 ? (
        <View style={styles.section}>
          <Text variant="heading">{t('driver.refills.finishedRuns')}</Text>
          {finished.map((refill) => (
            <FinishedRun key={refill.id} refill={refill} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function useRunWords(refill: DriverRefill) {
  const { t } = useTranslation();
  const size = refill.sizeLabel ?? refill.cylinderType?.name ?? refill.cylinderType?.code ?? '';
  const station = refill.fillingStation?.name ?? t('driver.refills.theStation');
  const store = refill.pickupStore?.name ?? t('driver.refills.theStore');
  return {
    title: t('driver.refills.run', { count: refill.requestedCount, size }),
    station,
    store,
    stage: stageOf(refill),
  };
}

function StageChip({ stage }: { stage: RefillStage }) {
  const { t } = useTranslation();
  const look = STAGE_LOOK[stage];
  return <StatusChip tone={look.tone} icon={look.icon} label={t(`driver.refills.stage.${stage}`)} />;
}

/** An open run: its stage and the one action of its step. Only the first run's action is the main button. */
function OpenRun({ refill, main }: { refill: DriverRefill; main: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const words = useRunWords(refill);
  const picked = pickedOf(refill);
  const [pickedCount, setPickedCount] = useState(Math.max(1, refill.requestedCount));
  // Null until the driver changes it: the count starts at every cylinder picked up.
  const [filledCount, setFilledCount] = useState<number | null>(null);

  const advance = useMutation<unknown, ApiError, RefillStep>({
    mutationFn: async (step) => {
      await api.patch(`/filling-orders/${refill.id}/${step.endpoint}`, 'body' in step ? step.body : {});
      await queryClient.invalidateQueries({ queryKey: REFILLS_QUERY_KEY });
    },
  });
  const variant = main ? 'primary' : 'secondary';
  const sending = t('driver.steps.sending');

  let action: ReactNode = null;
  switch (refill.status) {
    case 'ASSIGNED':
      action = (
        <>
          <Stepper
            label={t('driver.refills.picked')}
            helper={t('driver.refills.pickedHelp', { count: refill.requestedCount })}
            value={pickedCount}
            min={1}
            max={Math.max(1, refill.requestedCount)}
            onChange={setPickedCount}
            disabled={advance.isPending}
          />
          <Button
            label={t('driver.refills.markPicked', { count: pickedCount })}
            loadingLabel={sending}
            loading={advance.isPending}
            variant={variant}
            onPress={() => advance.mutate({ endpoint: 'picked-empties', body: { emptyCount: pickedCount } })}
          />
        </>
      );
      break;
    case 'EMPTIES_PICKED':
      action = (
        <Button
          label={t('driver.refills.atStation', { station: words.station })}
          loadingLabel={sending}
          loading={advance.isPending}
          variant={variant}
          onPress={() => advance.mutate({ endpoint: 'at-station' })}
        />
      );
      break;
    case 'AT_STATION': {
      const filled = Math.min(filledCount ?? picked, picked);
      action = (
        <>
          <Stepper
            label={t('driver.refills.filled')}
            helper={t('driver.refills.filledHelp', { count: picked })}
            value={filled}
            min={0}
            max={picked}
            onChange={setFilledCount}
            disabled={advance.isPending}
          />
          <Button
            label={t('driver.refills.markFilled', { count: filled })}
            loadingLabel={sending}
            loading={advance.isPending}
            variant={variant}
            onPress={() => advance.mutate({ endpoint: 'filled', body: { filledCount: filled } })}
          />
        </>
      );
      break;
    }
    case 'FILLED':
      action = (
        <Button
          label={t('driver.refills.markReturned')}
          loadingLabel={sending}
          loading={advance.isPending}
          variant={variant}
          onPress={() => advance.mutate({ endpoint: 'returned' })}
        />
      );
      break;
    case 'RETURNED':
      action = <Text tone="secondary">{t('driver.refills.returnedNote')}</Text>;
      break;
    default:
      action = null;
  }

  return (
    <Card testID={`refills.run.${refill.id}`}>
      <View style={styles.card}>
        <StageChip stage={words.stage} />
        <Text variant="heading" tabular>
          {words.title}
        </Text>
        {refill.distributor?.businessName ? (
          <Text tone="secondary">{t('driver.refills.forShop', { shop: refill.distributor.businessName })}</Text>
        ) : null}
        <Text tone="secondary">{t('driver.refills.pickupAt', { store: words.store })}</Text>
        <Text tone="secondary">{t('driver.refills.fillAt', { station: words.station })}</Text>
        {refill.status === 'FILLED' || refill.status === 'RETURNED' ? (
          <Text variant="bodyStrong" tabular>
            {t('driver.refills.filledOf', { filled: filledOf(refill), count: picked })}
          </Text>
        ) : null}
        {advance.error ? (
          <ErrorBanner error={advance.error} onRetry={advance.variables ? () => advance.mutate(advance.variables) : undefined} />
        ) : null}
        {action}
      </View>
    </Card>
  );
}

function FinishedRun({ refill }: { refill: DriverRefill }) {
  const { t } = useTranslation();
  const words = useRunWords(refill);
  const at = refill.completedAt ?? refill.createdAt;
  return (
    <Card testID={`refills.finished.${refill.id}`}>
      <View style={styles.card}>
        <StageChip stage={words.stage} />
        <Text variant="bodyStrong" tabular>
          {words.title}
        </Text>
        <Text tone="secondary">{t('driver.refills.fillAt', { station: words.station })}</Text>
        {words.stage === 'DONE' ? (
          <Text tone="secondary" tabular>
            {t('driver.refills.filledOf', { filled: filledOf(refill), count: pickedOf(refill) })}
          </Text>
        ) : null}
        {at ? <Text variant="caption" tone="secondary">{formatWhenText(at)}</Text> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: layout.sectionGap },
  section: { gap: layout.cardGap },
  card: { gap: space.md },
});
