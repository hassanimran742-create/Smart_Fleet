import { useMemo } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { SearchX, UserRound } from 'lucide-react';
import type { CylinderHistoryDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { toApiError } from '../../api/errors';
import { useNow } from '../../hooks/useNow';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  SkeletonText,
  StatusChip,
  Timeline,
  type TimelineItem,
} from '../../ui';
import { useDistributors } from '../distributors/api';
import { useCylinderHistory } from './api';
import { codeOfNumber } from './code';
import { FindCylinderBox } from './FindCylinderBox';
import { historyLine, holderLine } from './history';
import './cylinders.css';

const route = getRouteApi('/cylinders/find/$number');

/** The moves, oldest first, each with when and who. */
function historyItems(history: CylinderHistoryDto): TimelineItem[] {
  return history.events.map((event, index) => ({
    id: `${event.at}-${index}`,
    title: historyLine(event, history.events.slice(0, index)),
    at: event.at,
    meta: event.actor.name,
    tone: event.action === 'DELIVERED' ? 'success' : event.action === 'ADJUSTED' ? 'warning' : 'neutral',
  }));
}

function CylinderView({ history }: { history: CylinderHistoryDto }) {
  const { t } = useTranslation('cylinders');
  const now = useNow(60_000);
  const items = useMemo(() => historyItems(history), [history]);
  const responsible = history.holder.responsible;
  return (
    <div className="sf-cylinder">
      <section className="sf-cylinder__now">
        <p className="sf-cylinder__holder">{holderLine(history, now)}</p>
        <p className="sf-cylinder__line">
          <UserRound aria-hidden size={16} />
          <span>{responsible ? t('responsible', { name: responsible.name }) : t('responsibleNone')}</span>
        </p>
        {responsible ? <p className="sf-cylinder__muted">{t('responsibleHint')}</p> : null}
      </section>
      <section className="sf-cylinder__history" aria-labelledby="cylinder-history">
        <h2 id="cylinder-history" className="sf-cylinder__heading">
          {t('historyTitle')}
        </h2>
        {items.length > 0 ? <Timeline items={items} /> : <p className="sf-cylinder__muted">{t('historyEmpty')}</p>}
      </section>
    </div>
  );
}

/**
 * Find cylinder (`/cylinders/find/$number`, UX_ADMIN §3.5): the number, size, owner and state, where it
 * is now ("With Sana · AG-0142 · since 10:58 am"), the responsible driver, and every move in plain words
 * (`GET /cylinders/:code/history`). The header keeps a search box, so the next number is one Enter away.
 * Read only: nothing on this page changes a cylinder.
 */
export function CylinderPage() {
  const { t } = useTranslation(['cylinders', 'common', 'nav']);
  const { number } = route.useParams();
  const query = useCylinderHistory(number);
  const distributors = useDistributors();
  const history = query.data;
  const notFound = !history && query.isError && toApiError(query.error).is('NOT_FOUND');

  const owner = useMemo(() => {
    const code = codeOfNumber(history?.cylinder.shortCode);
    return code ? distributors.data?.find((distributor) => distributor.code === code)?.businessName : undefined;
  }, [distributors.data, history?.cylinder.shortCode]);

  const no = history?.cylinder.shortCode ?? number;
  // Not found or not loaded: the page's own name, with what was searched in the empty state below.
  const title = history ? (
    t('page.title', { no, size: history.cylinder.size.label })
  ) : query.isPending ? (
    <Skeleton width={200} height="1.2em" />
  ) : (
    t('nav:pages.findCylinder')
  );
  const state = history?.cylinder.state;

  return (
    <div className="sf-cylinder-page">
      <PageHeader
        back={null}
        title={title}
        chip={state ? <StatusChip kind="cylinder" value={state} /> : null}
        subtitle={owner}
        secondaryActions={<FindCylinderBox tone="page" className="sf-cylinder-page__find" />}
      />
      {query.isPending ? (
        <SkeletonText lines={6} />
      ) : notFound ? (
        <EmptyState icon={SearchX} title={t('page.notFound', { no: number })} body={t('page.notFoundHint')} />
      ) : !history ? (
        <ErrorState error={query.error} title={t('page.loadFailed')} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <CylinderView history={history} />
      )}
    </div>
  );
}
