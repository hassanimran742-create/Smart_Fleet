import type { ReactNode } from 'react';
import {
  Banknote,
  CircleCheck,
  ClipboardList,
  Clock,
  MessageSquareWarning,
  Store,
  Tags,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { AdminSummaryDto } from '@smartfleet/shared-types';
import { businessDate } from '@smartfleet/shared-utils';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { HrefLink } from '../../app/HrefLink';
import { useAdminSummary } from '../../hooks/useAdminSummary';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNow } from '../../hooks/useNow';
import { formatAgo, formatCalendarDate, formatNumber, formatWait } from '../../i18n/format';
import { cx, EmptyState, ErrorState, MoneyText, PageHeader, Skeleton, StaleBanner, type Tone } from '../../ui';
import './today.css';

/** A top-up waiting this long shows its wait as a warning (UX_ADMIN §2.1). */
const TOPUP_WARN_MS = 60 * 60_000;

type TodayCard =
  | { kind: 'topups'; count: number; oldestAt: string | null }
  | { kind: 'orders'; count: number; oldestAt: string | null }
  | { kind: 'problems'; count: number; oldestAt: string | null }
  | { kind: 'prices'; distributorId: string; distributorName: string; zones: number }
  | { kind: 'notStarted'; id: string; name: string };

/**
 * The "Needs you" cards, most urgent first (UX_ADMIN §2.1). Only cards with something waiting show.
 * One Missing prices card per `prices.missing` row (active distributors only); a distributor waiting
 * to start shows only its "not started" card. Customer problems arrive with Inc 2 (`summary.problems`).
 */
export function todayCards(summary: AdminSummaryDto): TodayCard[] {
  const cards: TodayCard[] = [];
  if (summary.topups.toCheck > 0) {
    cards.push({ kind: 'topups', count: summary.topups.toCheck, oldestAt: summary.topups.oldestWaitingAt });
  }
  if (summary.orders.needsDriver > 0) {
    cards.push({ kind: 'orders', count: summary.orders.needsDriver, oldestAt: summary.orders.oldestNeedsDriverAt });
  }
  if (summary.problems && summary.problems.open > 0) {
    cards.push({ kind: 'problems', count: summary.problems.open, oldestAt: summary.problems.oldestOpenAt });
  }
  for (const row of summary.prices.missing) {
    if (row.zones > 0) {
      cards.push({ kind: 'prices', distributorId: row.distributorId, distributorName: row.distributorName, zones: row.zones });
    }
  }
  for (const distributor of summary.distributors.waitingToStart) {
    cards.push({ kind: 'notStarted', id: distributor.id, name: distributor.name });
  }
  return cards;
}

function cardKey(card: TodayCard): string {
  if (card.kind === 'prices') return `prices-${card.distributorId}`;
  if (card.kind === 'notStarted') return `not-started-${card.id}`;
  return card.kind;
}

function msSince(at: string | null, now: number): number | null {
  if (!at) return null;
  const ms = now - new Date(at).getTime();
  return Number.isNaN(ms) ? null : Math.max(0, ms);
}

interface CardViewProps {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  detail?: ReactNode;
  action: ReactNode;
}

function CardView({ icon: Icon, tone, title, detail, action }: CardViewProps) {
  return (
    <li className={cx('sf-today__card', `sf-tone-${tone}`)}>
      <span className="sf-today__card-icon" aria-hidden>
        <Icon size={20} strokeWidth={2} />
      </span>
      <div className="sf-today__card-text">
        <p className="sf-today__card-title">{title}</p>
        {detail ? <div className="sf-today__card-detail">{detail}</div> : null}
      </div>
      <div className="sf-today__card-action">{action}</div>
    </li>
  );
}

function Card({ card, now }: { card: TodayCard; now: number }) {
  const { t } = useTranslation('today');
  switch (card.kind) {
    case 'topups': {
      const waited = msSince(card.oldestAt, now);
      const late = waited !== null && waited >= TOPUP_WARN_MS;
      return (
        <CardView
          icon={Banknote}
          tone={late ? 'warning' : 'info'}
          title={t('cards.topups.title', { count: card.count })}
          detail={
            waited !== null ? (
              <span className={cx('sf-today__wait', late && 'is-late')}>
                {late ? <TriangleAlert aria-hidden size={14} strokeWidth={2.25} /> : <Clock aria-hidden size={14} strokeWidth={2.25} />}
                {t('cards.topups.oldest', { wait: formatWait(card.oldestAt as string, now) })}
              </span>
            ) : null
          }
          action={
            <ButtonLink to="/topups" search={{ tab: 'to-check' }} variant="primary">
              {t('cards.topups.action')}
            </ButtonLink>
          }
        />
      );
    }
    case 'orders':
      return (
        <CardView
          icon={ClipboardList}
          tone="warning"
          title={t('cards.orders.title', { count: card.count })}
          detail={card.oldestAt ? t('cards.orders.oldest', { ago: formatAgo(card.oldestAt, now) }) : null}
          action={
            <ButtonLink to="/orders" search={{ tab: 'needs-driver' }}>
              {t('cards.orders.action')}
            </ButtonLink>
          }
        />
      );
    case 'problems':
      return (
        <CardView
          icon={MessageSquareWarning}
          tone="danger"
          title={t('cards.problems.title', { count: card.count })}
          detail={card.oldestAt ? t('cards.problems.oldest', { wait: formatWait(card.oldestAt, now) }) : null}
          action={
            // The Problems page arrives with Inc 2, together with its route.
            <HrefLink href="/problems" className="sf-btn sf-btn--secondary sf-btn--md">
              <span className="sf-btn__content">
                <span className="sf-btn__label">{t('cards.problems.action')}</span>
              </span>
            </HrefLink>
          }
        />
      );
    case 'prices':
      return (
        <CardView
          icon={Tags}
          tone="warning"
          title={t('cards.prices.title', { count: card.zones, distributor: card.distributorName })}
          detail={t('cards.prices.body')}
          action={
            <ButtonLink to="/prices/$distributorId" params={{ distributorId: card.distributorId }} search={{ missing: true }}>
              {t('cards.prices.action')}
            </ButtonLink>
          }
        />
      );
    case 'notStarted':
      return (
        <CardView
          icon={Store}
          tone="info"
          title={t('cards.notStarted.title', { name: card.name })}
          detail={t('cards.notStarted.body')}
          action={
            <ButtonLink to="/distributors/$id" params={{ id: card.id }}>
              {t('cards.notStarted.action')}
            </ButtonLink>
          }
        />
      );
  }
}

function SoFar({ summary }: { summary: AdminSummaryDto }) {
  const { t } = useTranslation('today');
  const approved = summary.topups.approvedToday;
  return (
    <section className="sf-today__section" aria-labelledby="today-so-far">
      <h2 id="today-so-far" className="sf-today__heading">
        {t('soFar.heading')}
      </h2>
      <dl className="sf-today__stats">
        <div className="sf-today__stat sf-today__stat--pair">
          <div className="sf-today__pair">
            <dt className="sf-today__stat-label">{t('soFar.orders')}</dt>
            <dd className="sf-today__stat-value">{formatNumber(summary.orders.placedToday)}</dd>
          </div>
          <div className="sf-today__pair">
            <dt className="sf-today__stat-label">{t('soFar.delivered')}</dt>
            <dd className="sf-today__stat-value">{formatNumber(summary.orders.deliveredToday)}</dd>
          </div>
        </div>
        <div className="sf-today__stat">
          <dt className="sf-today__stat-label">{t('soFar.costs')}</dt>
          <dd className="sf-today__stat-value">
            <MoneyText paisa={summary.orders.costTakenTodayPaisa} size="lg" strong />
          </dd>
          <dd className="sf-today__stat-hint">{t('soFar.costsHint')}</dd>
        </div>
        <div className="sf-today__stat">
          <dt className="sf-today__stat-label">{t('soFar.topups')}</dt>
          <dd className="sf-today__stat-value">
            <MoneyText paisa={approved.totalPaisa} size="lg" strong />
          </dd>
          <dd className="sf-today__stat-hint">{t('soFar.topupsCount', { count: approved.count })}</dd>
        </div>
        <div className="sf-today__stat">
          <dt className="sf-today__stat-label">{t('soFar.drivers')}</dt>
          <dd className="sf-today__stat-value">
            {t('soFar.driversValue', { onDuty: formatNumber(summary.drivers.onDuty), total: formatNumber(summary.drivers.total) })}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function TodaySkeleton() {
  return (
    <div aria-hidden className="sf-today__skeleton">
      <ul className="sf-today__cards">
        {[0, 1, 2].map((i) => (
          <li key={i} className="sf-today__card sf-today__card--skeleton">
            <Skeleton width={36} height={36} radius="md" />
            <div className="sf-today__card-text">
              <Skeleton width="55%" height="1.1em" />
              <Skeleton width="35%" />
            </div>
            <Skeleton width={120} height={36} radius="md" />
          </li>
        ))}
      </ul>
      <div className="sf-today__stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sf-today__stat">
            <Skeleton width="60%" />
            <Skeleton width="40%" height="1.6em" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Today (UX_ADMIN §2.1): what needs the office now and today's totals, from `GET /admin/summary`. The
 * same query feeds the navigation badges and the browser-tab count, and refreshes every 20 seconds.
 */
export function TodayPage() {
  const { t } = useTranslation(['today', 'common']);
  const summary = useAdminSummary();
  const { config } = useAppConfig();
  const now = useNow(15_000);
  const day = formatCalendarDate(businessDate(now, config.day));
  const data = summary.data;
  const cards = data ? todayCards(data) : [];

  return (
    <div className="sf-today">
      <PageHeader
        title={t('title', { date: day })}
        updatedAt={summary.dataUpdatedAt || null}
        onRefresh={() => void summary.refetch()}
        refreshing={summary.isFetching && !summary.isPending}
      />
      <StaleBanner query={summary} />

      {summary.isPending ? (
        <TodaySkeleton />
      ) : !data ? (
        <ErrorState
          error={summary.error}
          title={t('loadFailed')}
          onRetry={() => void summary.refetch()}
          retrying={summary.isFetching}
        />
      ) : (
        <>
          <section className="sf-today__section" aria-labelledby="today-needs-you">
            <h2 id="today-needs-you" className="sf-today__heading">
              {t('needsYou.heading')}
            </h2>
            {cards.length > 0 ? (
              <ul className="sf-today__cards">
                {cards.map((card) => (
                  <Card key={cardKey(card)} card={card} now={now} />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={CircleCheck}
                title={t('allClear.title')}
                body={data.problems ? t('allClear.bodyWithProblems') : t('allClear.body')}
              />
            )}
          </section>
          <SoFar summary={data} />
        </>
      )}
    </div>
  );
}
