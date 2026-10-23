import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../i18n/format';
import { activityActor, Button, cx, EmptyState, ErrorState, SkeletonText } from '../../ui';
import { useRecordActivity } from './api';
import { activityLine, activityWhy } from './sentences';

export interface RecordActivityProps {
  /** The audit rows' `resourceType` for this record, as the API writes it ("Payment" for a top-up). */
  resourceType: string;
  resourceId: string;
  /** The record's distributor, for sentences that name it ("Approved top-up AG-T031: Rs 5,000 for Ali Gas"). */
  distributorName?: string;
  className?: string;
}

/**
 * A record's history in the Activity log's own sentences (UX_ADMIN §2.9), for this lane's drawers. It
 * looks like the shared `<ActivityList />` and reads the same `activity` templates, and also puts a
 * reason that is only a code into words.
 */
export function RecordActivity({ resourceType, resourceId, distributorName, className }: RecordActivityProps) {
  const { t } = useTranslation();
  const query = useRecordActivity(resourceType, resourceId);
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const context = { distributorName: distributorName ? () => distributorName : undefined };

  return (
    <section className={cx('sf-activity', className)} aria-label={t('activity.title')}>
      <h3 className="sf-activity__title">{t('activity.title')}</h3>
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
                  <p className="sf-activity__sentence">{activityLine(row, context)}</p>
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
    </section>
  );
}
