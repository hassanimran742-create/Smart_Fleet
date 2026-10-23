import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditLogDto, Page } from '@smartfleet/shared-types';
import { toMessageParams } from '@smartfleet/shared-utils';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { qk } from '../api/keys';
import i18n, { translateDynamic } from '../i18n';
import { formatDateTime } from '../i18n/format';
import { AddMore } from './AddMore';
import { Button } from './Button';
import { cx } from './cx';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { SkeletonText } from './Skeleton';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalars(source: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!isRecord(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * The template params of an audit row: its scalar `diff` fields, then `diff.after`'s (which win), with
 * `*Paisa` keys also formatted as money without the suffix (`amountPaisa` adds `amount: "Rs 5,000"`),
 * plus `reason`.
 */
export function activityParams(row: AuditLogDto): Record<string, string | number | boolean> {
  const diff = row.diff ?? {};
  const merged = { ...scalars(diff), ...scalars(isRecord(diff) ? diff.after : undefined) };
  return { ...toMessageParams(merged), ...(row.reason ? { reason: row.reason } : {}) };
}

/** "topup.approve" → "Topup approve": how an action without a sentence is shown. */
export function actionInWords(action: string): string {
  const words = action.replace(/[._]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}

/** Left-over template syntax or a nested key path: the row lacks a field its sentence needs. */
const UNFILLED = /\{\{|\$t\(|(?:^|[\s(“])(?:parts|reasons)\./;

/**
 * One sentence for an audit row (UX_ADMIN §2.9), from `activity:<action>`, else the code in words (also
 * when the row lacks a field the sentence needs, so no placeholder ever shows).
 */
export function activitySentence(row: AuditLogDto): string {
  const text = translateDynamic(`activity:${row.action}`, activityParams(row));
  return text && !UNFILLED.test(text) ? text : actionInWords(row.action);
}

/** A reason stored as its code only (a shop's cancel without a note, a reject's reason code). */
const REASON_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * The "Why" of an audit row: what was typed, or the reason code in words (`activity:reasons.<action>.
 * <CODE>`) when only the code was stored. A top-up rejection's code is already in its sentence, so it
 * isn't repeated; null when there is nothing to show.
 */
export function activityWhy(row: AuditLogDto): string | null {
  const reason = row.reason?.trim();
  if (!reason) return null;
  if (!REASON_CODE.test(reason)) return reason;
  const diff = isRecord(row.diff) ? row.diff : {};
  if (row.action === 'topup.reject' && diff.reasonCode === reason) return null;
  return translateDynamic(`activity:reasons.${row.action}.${reason}`) ?? reason;
}

/** Who did it: the person's name, "System" for jobs and scripts, "Customer" for a link answer. */
export function activityActor(row: AuditLogDto): string {
  if (row.actor.kind === 'SYSTEM') return i18n.t('common:actor.system');
  if (row.actor.kind === 'CUSTOMER') return i18n.t('common:actor.customer');
  return row.actor.name ?? row.actor.label ?? i18n.t('common:actor.system');
}

export interface ActivityListProps {
  /** The audit row's `resourceType`, for example "payment", "order" or "distributor". */
  resourceType: string;
  resourceId: string;
  /** "Activity" by default. */
  title?: string;
  /** Rows per page; 10 by default. */
  pageSize?: number;
  /**
   * Closed behind a ghost toggle "Activity (3)" at the end of a drawer or page, opening in place
   * (UX_ADMIN §1.5); true by default. False shows the heading and the list.
   */
  collapsible?: boolean;
  /** Open from the start when collapsible. */
  defaultOpen?: boolean;
  className?: string;
}

/** A record's history in plain sentences (`GET /audit-logs?resourceType&resourceId`), newest first. */
export function ActivityList({
  resourceType,
  resourceId,
  title,
  pageSize = 10,
  collapsible = true,
  defaultOpen = false,
  className,
}: ActivityListProps) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({
    queryKey: qk.activity.record(resourceType, resourceId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.get<Page<AuditLogDto> | AuditLogDto[]>('/audit-logs', {
        params: { resourceType, resourceId, limit: pageSize, cursor: pageParam ?? undefined },
        signal,
      });
      // Older APIs answer with a plain array.
      return Array.isArray(data) ? { items: data, nextCursor: null } : data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const heading = title ?? t('activity.title');

  const content = (
    <>
      {query.isPending ? (
        <SkeletonText lines={3} />
      ) : query.isError && rows.length === 0 ? (
        <ErrorState compact error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState compact title={t('activity.empty')} />
      ) : (
        <>
          <ol className="sf-activity__list">
            {rows.map((row) => {
              const why = activityWhy(row);
              return (
                <li key={row.id} className="sf-activity__item">
                  <p className="sf-activity__sentence">{activitySentence(row)}</p>
                  <p className="sf-activity__meta">
                    <span>{t('activity.by', { name: activityActor(row) })}</span>
                    <span aria-hidden> · </span>
                    <time dateTime={row.at}>{formatDateTime(row.at)}</time>
                  </p>
                  {why ? <p className="sf-activity__why">{t('activity.why', { reason: why })}</p> : null}
                </li>
              );
            })}
          </ol>
          {query.hasNextPage ? (
            <Button size="sm" variant="ghost" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
              {t('actions.showMore')}
            </Button>
          ) : null}
        </>
      )}
    </>
  );

  if (collapsible) {
    // "Activity (10+)" while older entries are still to load, so the count is never too low.
    const label = !query.isSuccess
      ? heading
      : query.hasNextPage
        ? t('activity.toggleMore', { count: rows.length })
        : t('activity.toggle', { count: rows.length });
    return (
      <section className={cx('sf-activity', 'sf-activity--collapsible', className)} aria-label={heading}>
        <AddMore variant="toggle" label={label} defaultOpen={defaultOpen}>
          {content}
        </AddMore>
      </section>
    );
  }

  return (
    <section className={cx('sf-activity', className)} aria-label={heading}>
      <h3 className="sf-activity__title">{heading}</h3>
      {content}
    </section>
  );
}
