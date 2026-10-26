import { useMemo, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { SearchX, UserRoundCheck } from 'lucide-react';
import type { AuditLogDto, RefillLineDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { toApiError } from '../../api/errors';
import { useCloseDrawer } from '../../app/drawer';
import i18n from '../../i18n';
import { formatDateTime } from '../../i18n/format';
import {
  ActivityList,
  activityActor,
  AddMore,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonText,
  StaleBanner,
  Timeline,
  useStaleness,
  type TimelineItem,
} from '../../ui';
import { listedRefill, useRefill, useRefillHistory, type RefillRow } from './api';
import { AssignRefillDialog } from './AssignRefillDialog';
import { RefillStageChip, refillCylinders, refillDriver } from './format';
import './refills.css';

const route = getRouteApi('/refills/$refillId');

function earliest(values: readonly (string | null)[]): string | null {
  const times = values.filter((value): value is string => Boolean(value)).sort();
  return times[0] ?? null;
}

function latest(values: readonly (string | null)[]): string | null {
  const times = values.filter((value): value is string => Boolean(value)).sort();
  return times[times.length - 1] ?? null;
}

/**
 * The refill's timeline with counts (UX_ADMIN §4.1): Requested · Driver assigned · Picked up 2 of 2 ·
 * Filled 2 of 2 · Back at store 1 of 2 · Done, or Cancelled with its reason. A step shows once reached;
 * the times come from the refill, its picked cylinders and the assign's audit row.
 */
export function refillTimeline(refill: RefillRow, history: readonly AuditLogDto[] | undefined): TimelineItem[] {
  const t = i18n.t;
  const { counts } = refill;
  const lines = refill.cylinders ?? [];
  const items: TimelineItem[] = [{ id: 'requested', title: t('refills:timeline.requested'), at: refill.createdAt }];
  const assignRow = (history ?? []).find((row) => row.action === 'refill.assign');
  if (refill.assignedDriver || assignRow) {
    items.push({
      id: 'assigned',
      title: t('refills:timeline.assigned'),
      at: assignRow?.at ?? null,
      meta: refillDriver(refill) ?? (assignRow ? activityActor(assignRow) : undefined),
      tone: 'info',
    });
  }
  if (counts.picked > 0) {
    items.push({
      id: 'picked',
      title: t('refills:timeline.picked', { done: counts.picked, total: counts.requested }),
      at: refill.pickedUpAt ?? earliest(lines.map((line) => line.pickedUpAt)),
      tone: 'info',
    });
  }
  if (counts.filled > 0) {
    items.push({
      id: 'filled',
      title: t('refills:timeline.filled', { done: counts.filled, total: counts.picked }),
      at: earliest(lines.map((line) => line.filledAt)),
      tone: 'info',
    });
  }
  if (counts.received > 0) {
    items.push({
      id: 'back',
      title: t('refills:timeline.back', { done: counts.received, total: counts.picked }),
      at: latest(lines.map((line) => line.returnedAt)),
      tone: 'info',
    });
  }
  if (refill.stage === 'DONE') items.push({ id: 'done', title: t('refills:timeline.done'), at: refill.completedAt, tone: 'success' });
  if (refill.stage === 'CANCELLED') {
    items.push({
      id: 'cancelled',
      title: t('refills:timeline.cancelled'),
      at: refill.cancelledAt ?? null,
      meta: refill.cancellationReason ? t('refills:timeline.reason', { reason: refill.cancellationReason }) : undefined,
      tone: 'neutral',
    });
  }
  return items;
}

/** One picked cylinder's step: picked up, filled, or back at the store (with or without a fill). */
function lineStep(line: RefillLineDto): { words: string; at: string | null } {
  const t = i18n.t;
  if (line.status === 'RETURNED') {
    return { words: line.filledAt ? t('refills:line.RETURNED') : t('refills:line.RETURNED_UNFILLED'), at: line.returnedAt };
  }
  if (line.status === 'FILLED') return { words: t('refills:line.FILLED'), at: line.filledAt };
  return { words: t('refills:line.PICKED_UP'), at: line.pickedUpAt };
}

/** "Show cylinders": the scan list, one row per picked cylinder. */
function CylinderLines({ lines }: { lines: readonly RefillLineDto[] }) {
  const { t } = useTranslation('refills');
  if (lines.length === 0) return <p className="sf-refills__muted">{t('drawer.noCylinders')}</p>;
  return (
    <ul className="sf-refill__lines">
      {lines.map((line) => {
        const step = lineStep(line);
        return (
          <li key={line.id} className="sf-refill__line">
            <span className="sf-record-no">{line.cylinder.shortCode ?? line.cylinder.code}</span>
            <span className="sf-refills__muted">
              {step.at ? t('line.at', { step: step.words, time: formatDateTime(step.at) }) : step.words}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DrawerSkeleton() {
  return (
    <div className="sf-refill__skeleton" aria-hidden>
      <Skeleton width="40%" />
      <SkeletonText lines={4} />
    </div>
  );
}

/** The refill's number from a list row already on screen, for the title while the drawer loads. */
function useCachedShortCode(refillId: string): string | null {
  const queryClient = useQueryClient();
  return useMemo(() => listedRefill(queryClient, refillId)?.shortCode ?? null, [queryClient, refillId]);
}

/**
 * The refill drawer (`/refills/$refillId`, 480 px, UX_ADMIN §4.1): "Refill AG-R001" with its status chip,
 * "Ahmed Gas · 2 × 11.8 kg · Lahore Filling Station", the timeline with counts, "Show cylinders" (the
 * scan list), the line "Only Ahmed Gas can cancel, before pickup." and, while it needs a driver, the
 * primary "Assign driver". No office cancel, no "Could not deliver" and no money (ADR-16).
 */
export function RefillDrawer() {
  const { t } = useTranslation(['refills', 'common']);
  const { refillId } = route.useParams();
  const close = useCloseDrawer();
  const query = useRefill(refillId);
  const refill = query.data;
  const cachedShortCode = useCachedShortCode(refillId);
  const history = useRefillHistory(refillId, refill?.assignedDriver?.id ?? null);
  const staleness = useStaleness(query);
  const [assigning, setAssigning] = useState(false);
  const timeline = useMemo(() => (refill ? refillTimeline(refill, history.data) : []), [refill, history.data]);

  const no = refill?.shortCode ?? cachedShortCode;
  const canAssign = refill?.allowedActions?.includes('ASSIGN') ?? false;
  const station = refill?.fillingStation?.name;
  const subtitle = refill
    ? station
      ? t('drawer.subtitle', { distributor: refill.distributor.businessName, cylinders: refillCylinders(refill), station })
      : t('drawer.subtitleNoStation', { distributor: refill.distributor.businessName, cylinders: refillCylinders(refill) })
    : undefined;

  return (
    <>
      <Drawer
        title={no ? t('drawer.title', { no }) : refill ? t('drawer.titleNoNumber') : <Skeleton width={160} height="1.2em" />}
        chip={refill ? <RefillStageChip refill={refill} /> : null}
        subtitle={subtitle}
        onClose={close}
        notice={refill && staleness.kind ? <StaleBanner query={query} /> : undefined}
        footer={
          canAssign
            ? {
                end: (
                  <Button variant="primary" icon={UserRoundCheck} onClick={() => setAssigning(true)}>
                    {t('assign')}
                  </Button>
                ),
              }
            : undefined
        }
      >
        {query.isPending ? (
          <DrawerSkeleton />
        ) : !refill && toApiError(query.error).is('NOT_FOUND') ? (
          <EmptyState icon={SearchX} title={t('drawer.notFound')} />
        ) : !refill ? (
          <ErrorState error={query.error} title={t('drawer.loadFailed')} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : (
          <>
            <section className="sf-refill__section" aria-labelledby="refill-timeline">
              <h3 id="refill-timeline" className="sf-refill__section-title">
                {t('drawer.timelineTitle')}
              </h3>
              <Timeline items={timeline} />
              <AddMore variant="toggle" label={t('drawer.showCylinders')}>
                <CylinderLines lines={refill.cylinders ?? []} />
              </AddMore>
            </section>
            {refill.stage !== 'CANCELLED' ? (
              <p className="sf-refills__muted sf-refill__owner">{t('drawer.onlyOwner', { distributor: refill.distributor.businessName })}</p>
            ) : null}
            <ActivityList resourceType="refill" resourceId={refill.id} />
          </>
        )}
      </Drawer>

      {refill && assigning ? <AssignRefillDialog refill={refill} onClose={() => setAssigning(false)} onAssigned={close} /> : null}
    </>
  );
}
