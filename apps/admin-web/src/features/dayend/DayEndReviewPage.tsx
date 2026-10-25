import { useEffect, useMemo, useRef, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, RotateCcw, SearchX, Undo2 } from 'lucide-react';
import type { AdminDayEndDetail, DayCloseDifferenceDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { messageFor, toApiError } from '../../api/errors';
import { formatCalendarDate, formatNumber, formatTime } from '../../i18n/format';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterChips,
  InlineAlert,
  KeyValueList,
  PageHeader,
  Skeleton,
  SkeletonText,
  Table,
  useConfirm,
  useToast,
  type TableColumn,
} from '../../ui';
import { useDistributor } from '../distributors/api';
import { whenText } from '../orders/format';
import { fileUrl, invalidateDayEnd, useApproveDayEnd, useDayEnd, useReopenDayEnd, useSendBackDayEnd } from './api';
import { DayEndOff } from './DayEndOff';
import { appSays, DayEndStageChip, FixChip, lineDiff, ofKind, sheetSays, type DiffKind } from './format';
import './dayend.css';

const route = getRouteApi('/day-end/$dayEndId');

/** The kind filter shows only with more than this many rows (UX_ADMIN §4.3). */
const FILTER_FROM = 11;
/** The send-back and reopen reasons: 5–300 characters. */
const REASON_MIN = 5;
const REASON_MAX = 300;

/** One sheet's download: asked for at each click (the address is signed for an hour). */
function FileLink({ fileId, label }: { fileId: string; label: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // The sheet downloads; the page stays.
      window.location.assign(await fileUrl(fileId));
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="ghost" size="sm" icon={FileSpreadsheet} loading={busy} onClick={() => void open()}>
      {label}
    </Button>
  );
}

/**
 * The review keeps the version the office is reading: a newer upload only replaces it after "Load new
 * version", so nothing changes under the office's eyes and nothing is approved unseen (UX_ADMIN §4.3).
 */
function useShownDay(latest: AdminDayEndDetail | undefined) {
  const [shown, setShown] = useState<AdminDayEndDetail | undefined>(latest);
  useEffect(() => {
    if (!latest) return;
    setShown((current) => (!current || current.id !== latest.id || current.version === latest.version ? latest : current));
  }, [latest]);
  const newer = latest && shown && latest.id === shown.id && latest.version !== shown.version ? latest : null;
  return { shown, newer, loadNewer: () => setShown(latest) };
}

function Facts({ day }: { day: AdminDayEndDetail }) {
  const { t } = useTranslation('dayend');
  return (
    <KeyValueList
      stacked
      className="sf-dayend__facts"
      items={[
        { id: 'store', label: t('review.stats.inStore'), value: formatNumber(day.summary.inStore.total) },
        { id: 'vans', label: t('review.stats.onVans'), value: formatNumber(day.summary.onVans) },
        { id: 'customers', label: t('review.stats.withCustomers'), value: formatNumber(day.summary.withCustomers) },
        { id: 'differences', label: t('review.stats.differences'), value: formatNumber(day.differences) },
      ]}
    />
  );
}

/**
 * Day-end review (`/day-end/$dayEndId`, UX_ADMIN §4.3, Inc 2/3 spec §4.10): the shop's differences and
 * what approval would fix, then approve and lock the day, or send it back with what to fix. Each decision
 * asks first (rulebook rule 7). A locked day is read only, with "Reopen…" for the rare correction.
 * Nothing changes until the office approves, and day-end never moves money (ADR-17).
 */
export function DayEndReviewPage() {
  const { t } = useTranslation(['dayend', 'common', 'nav']);
  const { dayEndId } = route.useParams();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const query = useDayEnd(dayEndId);
  const { shown: day, newer, loadNewer } = useShownDay(query.data);
  const distributor = useDistributor(day?.distributor.id);
  const approve = useApproveDayEnd(dayEndId);
  const sendBack = useSendBackDayEnd(dayEndId);
  const reopen = useReopenDayEnd(dayEndId);
  const [kind, setKind] = useState<DiffKind>('all');
  const [registered, setRegistered] = useState(0);
  /** Set while an approval met a newer upload: the page then says so and offers it. */
  const versionChanged = useRef(false);

  const store = distributor.data?.store?.name ?? t('review.theStore');
  const lines = day?.lines;
  const rows = useMemo(() => (lines ?? []).filter((line) => ofKind(line, kind)), [lines, kind]);
  const actions = day?.allowedActions ?? [];
  const fixes = day?.fixesToApply.length ?? 0;

  const columns = useMemo<TableColumn<DayCloseDifferenceDto>[]>(
    () => [
      {
        id: 'cylinder',
        header: t('review.columns.cylinder'),
        cell: (line) => (
          <span className="sf-dayend__two-line">
            <span className="sf-record-no">
              {line.sizeLabel ? t('review.cylinder', { no: line.shortCode, size: line.sizeLabel }) : line.shortCode}
            </span>
            <span className="sf-dayend__muted">{t(`review.diff.${lineDiff(line)}`)}</span>
          </span>
        ),
        priority: 1,
        sticky: true,
      },
      { id: 'app', header: t('review.columns.app'), cell: (line) => appSays(line) ?? t('review.notInApp'), priority: 1 },
      { id: 'sheet', header: t('review.columns.sheet'), cell: (line) => sheetSays(line) ?? t('review.notInApp'), priority: 1 },
      { id: 'fix', header: t('review.columns.fix'), cell: (line) => <FixChip line={line} store={store} />, priority: 1 },
      {
        id: 'note',
        header: t('review.columns.note'),
        cell: (line) => (line.note ? <span className="sf-dayend__note">{line.note}</span> : t('review.notInApp')),
        priority: 2,
      },
      {
        id: 'lastScan',
        header: t('review.columns.lastScan'),
        cell: (line) => <span className="sf-dayend__nowrap">{line.lastScanAt ? whenText(line.lastScanAt) : t('review.notInApp')}</span>,
        priority: 3,
      },
    ],
    [store, t],
  );

  if (query.isError && !query.data && toApiError(query.error).is('FEATURE_DISABLED')) {
    return (
      <div className="sf-dayend">
        <PageHeader title={t('nav:pages.dayEndReview')} />
        <DayEndOff />
      </div>
    );
  }

  if (!day) {
    const notFound = query.isError && toApiError(query.error).is('DAY_NOT_FOUND', 'NOT_FOUND');
    return (
      <div className="sf-dayend">
        <PageHeader title={query.isPending ? <Skeleton width={240} height="1.2em" /> : t('nav:pages.dayEndReview')} />
        {query.isPending ? (
          <SkeletonText lines={6} />
        ) : notFound ? (
          <EmptyState icon={SearchX} title={messageFor(query.error)} />
        ) : (
          <ErrorState error={query.error} title={t('review.loadFailed')} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        )}
      </div>
    );
  }

  const dayText = formatCalendarDate(day.businessDate);
  const name = day.distributor.businessName;
  const afterDecision = () => void invalidateDayEnd(queryClient, dayEndId);

  const onApprove = async () => {
    versionChanged.current = false;
    const { ok } = await confirm({
      title: t('review.approveDialog.title', { day: dayText }),
      body: fixes > 0 ? t('review.approveDialog.body', { count: fixes }) : t('review.approveDialog.bodyNone'),
      confirmLabel: t('review.approveDialog.confirm'),
      action: async () => {
        try {
          const result = await approve.mutateAsync({ version: day.version });
          setRegistered(result.registered.length);
        } catch (error) {
          // A newer upload since the page loaded: close, say so, and offer it (nothing was applied).
          if (toApiError(error).is('DAY_VERSION_CHANGED')) {
            versionChanged.current = true;
            await query.refetch();
            return;
          }
          // Sent back or approved meanwhile: the page catches up while the dialog says why.
          void query.refetch();
          throw error;
        }
      },
    });
    if (!ok) return;
    afterDecision();
    if (!versionChanged.current) toast.success(t('review.approveDialog.toast', { day: dayText }));
  };

  const onSendBack = async () => {
    const { ok } = await confirm({
      title: t('review.sendBackDialog.title', { distributor: name }),
      tone: 'danger',
      confirmLabel: t('review.sendBackDialog.confirm'),
      reason: { label: t('review.sendBackDialog.field'), required: true, minLength: REASON_MIN, maxLength: REASON_MAX },
      action: ({ reason }) => sendBack.mutateAsync({ reason: reason ?? '' }),
    });
    if (!ok) return;
    afterDecision();
    toast.success(t('review.sendBackDialog.toast', { distributor: name }));
  };

  const onReopen = async () => {
    const { ok } = await confirm({
      title: t('review.reopenDialog.title', { day: dayText }),
      body: t('review.reopenDialog.body', { distributor: name }),
      tone: 'warning',
      confirmLabel: t('review.reopenDialog.confirm'),
      reason: { label: t('review.reopenDialog.field'), required: true, minLength: REASON_MIN, maxLength: REASON_MAX },
      action: ({ reason }) => reopen.mutateAsync({ reason: reason ?? '' }),
    });
    if (!ok) return;
    setRegistered(0);
    afterDecision();
    toast.success(t('review.reopenDialog.toast'));
  };

  const canApprove = actions.includes('APPROVE');
  const canSendBack = actions.includes('SEND_BACK');
  const canReopen = actions.includes('REOPEN');
  const filterShown = (lines?.length ?? 0) >= FILTER_FROM;

  return (
    <div className="sf-dayend">
      <PageHeader
        title={t('review.title', { distributor: name, day: dayText })}
        chip={<DayEndStageChip stage={day.stage} />}
        meta={day.uploadedAt ? t('review.meta', { version: day.version, time: whenText(day.uploadedAt) }) : undefined}
        secondaryActions={
          <>
            {canSendBack ? (
              <Button variant="ghost-danger" icon={Undo2} onClick={() => void onSendBack()}>
                {t('review.sendBack')}
              </Button>
            ) : null}
            {canReopen ? (
              <Button icon={RotateCcw} onClick={() => void onReopen()}>
                {t('review.reopen')}
              </Button>
            ) : null}
          </>
        }
        primaryAction={
          canApprove ? (
            <Button variant="primary" onClick={() => void onApprove()}>
              {fixes > 0 ? t('review.approve', { count: fixes }) : t('review.approveNone')}
            </Button>
          ) : null
        }
      />

      {newer ? (
        <InlineAlert
          tone="warning"
          live
          action={
            <Button size="sm" onClick={loadNewer}>
              {t('review.loadNew')}
            </Button>
          }
        >
          {t('review.versionChanged', { distributor: name, time: newer.uploadedAt ? formatTime(newer.uploadedAt) : '' })}
        </InlineAlert>
      ) : null}
      {registered > 0 ? (
        <InlineAlert tone="success" live>
          {t('review.registered', { count: registered })}
        </InlineAlert>
      ) : null}

      <Facts day={day} />

      <div className="sf-dayend__files">
        {canApprove ? <p className="sf-dayend__muted">{t('review.info')}</p> : null}
        {day.files.uploadFileId || day.files.sheetFileId ? (
          <div className="sf-dayend__download">
            <span className="sf-dayend__muted">{t('review.download')}</span>
            {day.files.uploadFileId ? <FileLink fileId={day.files.uploadFileId} label={t('review.files.upload')} /> : null}
            {day.files.sheetFileId ? <FileLink fileId={day.files.sheetFileId} label={t('review.files.app')} /> : null}
          </div>
        ) : null}
      </div>

      {filterShown ? (
        <FilterChips<DiffKind>
          label={t('review.filter.label')}
          className="sf-dayend__kinds"
          options={[
            { value: 'all', label: t('review.filter.all') },
            { value: 'place', label: t('review.filter.place') },
            { value: 'state', label: t('review.filter.state') },
            { value: 'newNumber', label: t('review.filter.newNumber') },
          ]}
          value={kind}
          onChange={setKind}
        />
      ) : null}

      <Table<DayCloseDifferenceDto>
        caption={t('review.caption')}
        columns={columns}
        rows={rows}
        rowKey={(line) => line.id}
        state="ready"
        empty={<EmptyState compact icon={FileSpreadsheet} title={t('review.noDifferences')} />}
      />
    </div>
  );
}
