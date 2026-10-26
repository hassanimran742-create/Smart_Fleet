import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Banknote,
  CircleCheck,
  ClipboardList,
  FileSpreadsheet,
  MessageSquareWarning,
  RefreshCw,
  Store,
  Tags,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { AdminSummaryDto, IdName } from '@smartfleet/shared-types';
import { businessDate } from '@smartfleet/shared-utils';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { useAdminSummary } from '../../hooks/useAdminSummary';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNow } from '../../hooks/useNow';
import { formatCalendarDate, formatNumber, formatTime, formatWait } from '../../i18n/format';
import { cx, ErrorState, MoneyText, PageHeader, Skeleton, StaleBanner, useStaleness } from '../../ui';
import './today.css';

/** A top-up waiting this long shows its wait as a warning (UX_ADMIN §2.1). */
const TOPUP_WARN_MS = 60 * 60_000;
/** Names shown in a card's detail line before "+2 more" (website spec W05). */
const PRICE_NAMES = 3;
const WAITING_NAMES = 2;

type MissingPrice = AdminSummaryDto['prices']['missing'][number];

type DayEndOldest = NonNullable<NonNullable<AdminSummaryDto['dayEnd']>['oldest']>;

type TodayCard =
  | { kind: 'topups'; count: number; oldestAt: string | null }
  | { kind: 'orders'; count: number; oldestAt: string | null }
  | { kind: 'problems'; count: number; oldestAt: string | null }
  | { kind: 'refills'; count: number; oldestAt: string | null }
  | { kind: 'dayEnd'; count: number; oldest: DayEndOldest | null }
  | { kind: 'prices'; count: number; rows: MissingPrice[]; target: string }
  | { kind: 'waiting'; count: number; distributors: IdName[] };

/**
 * The "needs you" cards, in the order of website spec W05: Top-ups, Orders, (Inc 2) Customer
 * problems, (Inc 3) Refills and Day-end, Prices, Distributors. Only cards with a count above 0 show.
 * Missing prices are one card for every distributor (the API lists active distributors only); "Set
 * prices" opens the one with the most zones missing. Distributors waiting to start are one card too.
 * The Inc 3 cards read `summary.refills` and `summary.dayEnd` (the second is absent while day-end is off).
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
  if (summary.refills && summary.refills.needsDriver > 0) {
    cards.push({ kind: 'refills', count: summary.refills.needsDriver, oldestAt: summary.refills.oldestNeedsDriverAt });
  }
  if (summary.dayEnd && summary.dayEnd.toApprove > 0) {
    cards.push({ kind: 'dayEnd', count: summary.dayEnd.toApprove, oldest: summary.dayEnd.oldest });
  }
  const missing = summary.prices.missing.filter((row) => row.zones > 0);
  if (missing.length > 0) {
    const worst = missing.reduce((best, row) => (row.zones > best.zones ? row : best));
    cards.push({
      kind: 'prices',
      count: missing.reduce((sum, row) => sum + row.zones, 0),
      rows: missing,
      target: worst.distributorId,
    });
  }
  if (summary.distributors.waitingToStart.length > 0) {
    cards.push({ kind: 'waiting', count: summary.distributors.waitingToStart.length, distributors: summary.distributors.waitingToStart });
  }
  return cards;
}

function msSince(at: string | null, now: number): number | null {
  if (!at) return null;
  const ms = now - new Date(at).getTime();
  return Number.isNaN(ms) ? null : Math.max(0, ms);
}

/** "Ahmed Gas 1 · Bilal Gas 2 · +2 more": the first names, then how many more. */
function namesLine(names: readonly string[], fit: number, more: (count: number) => string): string {
  const shown = names.slice(0, fit);
  const rest = names.length - shown.length;
  return [...shown, ...(rest > 0 ? [more(rest)] : [])].join(' · ');
}

interface CardViewProps {
  icon: LucideIcon;
  count: number;
  label: string;
  detail?: ReactNode;
  /** The one secondary button across the card's foot; it is also the link of the whole card. */
  action: ReactNode;
}

/** A big count, its label, one muted detail line and one button (UX_ADMIN §2.1). */
function CardView({ icon: Icon, count, label, detail, action }: CardViewProps) {
  return (
    <li className="sf-today__card">
      <div className="sf-today__card-head">
        <span className="sf-today__card-icon sf-tone-info" aria-hidden>
          <Icon size={20} strokeWidth={2} />
        </span>
        <span className="sf-today__card-count">{formatNumber(count)}</span>
      </div>
      <p className="sf-today__card-label">{label}</p>
      {detail ? <p className="sf-today__card-detail">{detail}</p> : null}
      <div className="sf-today__card-action">{action}</div>
    </li>
  );
}

function Card({ card, now }: { card: TodayCard; now: number }) {
  const { t } = useTranslation('today');
  const more = (count: number) => t('cards.more', { count });
  switch (card.kind) {
    case 'topups': {
      const waited = msSince(card.oldestAt, now);
      const late = waited !== null && waited >= TOPUP_WARN_MS;
      return (
        <CardView
          icon={Banknote}
          count={card.count}
          label={t('cards.topups.label', { count: card.count })}
          detail={
            card.oldestAt && waited !== null ? (
              <span className={cx('sf-today__wait', late && 'is-late')}>
                {late ? <TriangleAlert aria-hidden size={14} strokeWidth={2.25} /> : null}
                {t('cards.topups.oldest', { wait: formatWait(card.oldestAt, now) })}
              </span>
            ) : null
          }
          action={
            <ButtonLink to="/topups" search={{ tab: 'to-check' }} className="sf-today__card-link">
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
          count={card.count}
          label={t('cards.orders.label', { count: card.count })}
          detail={card.oldestAt ? t('cards.orders.oldest', { wait: formatWait(card.oldestAt, now) }) : null}
          action={
            <ButtonLink to="/orders" search={{ tab: 'needs-driver' }} className="sf-today__card-link">
              {t('cards.orders.action')}
            </ButtonLink>
          }
        />
      );
    case 'problems':
      return (
        <CardView
          icon={MessageSquareWarning}
          count={card.count}
          label={t('cards.problems.label', { count: card.count })}
          detail={card.oldestAt ? t('cards.problems.oldest', { wait: formatWait(card.oldestAt, now) }) : null}
          action={
            <ButtonLink to="/problems" className="sf-today__card-link">
              {t('cards.problems.action')}
            </ButtonLink>
          }
        />
      );
    case 'refills':
      return (
        <CardView
          icon={RefreshCw}
          count={card.count}
          label={t('cards.refills.label', { count: card.count })}
          detail={card.oldestAt ? t('cards.refills.oldest', { wait: formatWait(card.oldestAt, now) }) : null}
          action={
            // Needs a driver is the Refills page's first tab.
            <ButtonLink to="/refills" search={{}} className="sf-today__card-link">
              {t('cards.refills.action')}
            </ButtonLink>
          }
        />
      );
    case 'dayEnd': {
      const oldest = card.oldest;
      const day = oldest ? formatCalendarDate(oldest.businessDate) : null;
      return (
        <CardView
          icon={FileSpreadsheet}
          count={card.count}
          label={t('cards.dayEnd.label', { count: card.count })}
          detail={
            oldest && day
              ? card.count === 1
                ? t('cards.dayEnd.one', { distributor: oldest.distributor.name, day })
                : t('cards.dayEnd.oldest', { day })
              : null
          }
          action={
            // To approve is the Day-end page's first tab.
            <ButtonLink to="/day-end" search={{}} className="sf-today__card-link">
              {t('cards.dayEnd.action')}
            </ButtonLink>
          }
        />
      );
    }
    case 'prices':
      return (
        <CardView
          icon={Tags}
          count={card.count}
          label={t('cards.prices.label', { count: card.count })}
          detail={namesLine(
            card.rows.map((row) => t('cards.prices.item', { distributor: row.distributorName, zones: formatNumber(row.zones) })),
            PRICE_NAMES,
            more,
          )}
          action={
            <ButtonLink
              to="/prices/$distributorId"
              params={{ distributorId: card.target }}
              search={{ missing: true }}
              className="sf-today__card-link"
            >
              {t('cards.prices.action')}
            </ButtonLink>
          }
        />
      );
    case 'waiting': {
      const [only] = card.distributors;
      return (
        <CardView
          icon={Store}
          count={card.count}
          label={t('cards.waiting.label', { count: card.count })}
          detail={namesLine(
            card.distributors.map((row) => row.name),
            WAITING_NAMES,
            more,
          )}
          action={
            card.distributors.length === 1 && only ? (
              <ButtonLink to="/distributors/$id" params={{ id: only.id }} className="sf-today__card-link">
                {t('cards.waiting.action')}
              </ButtonLink>
            ) : (
              // Waiting distributors sort first on the list.
              <ButtonLink to="/distributors" search={{}} className="sf-today__card-link">
                {t('cards.waiting.action')}
              </ButtonLink>
            )
          }
        />
      );
    }
  }
}

function cardKey(card: TodayCard): string {
  return card.kind;
}

/** "Today so far": five small tiles; the drivers tile opens Drivers. */
function SoFar({ summary }: { summary: AdminSummaryDto }) {
  const { t } = useTranslation('today');
  const approved = summary.topups.approvedToday;
  return (
    <section className="sf-today__section" aria-labelledby="today-so-far">
      <h2 id="today-so-far" className="sf-today__heading">
        {t('soFar.heading')}
      </h2>
      <ul className="sf-today__stats">
        <li className="sf-today__stat">
          <span className="sf-today__stat-label">{t('soFar.orders')}</span>
          <span className="sf-today__stat-value">{formatNumber(summary.orders.placedToday)}</span>
        </li>
        <li className="sf-today__stat">
          <span className="sf-today__stat-label">{t('soFar.delivered')}</span>
          <span className="sf-today__stat-value">{formatNumber(summary.orders.deliveredToday)}</span>
        </li>
        <li className="sf-today__stat">
          <span className="sf-today__stat-label">{t('soFar.costs')}</span>
          <span className="sf-today__stat-value">
            <MoneyText paisa={summary.orders.costTakenTodayPaisa} size="lg" strong />
          </span>
        </li>
        <li className="sf-today__stat">
          <span className="sf-today__stat-label">{t('soFar.topups')}</span>
          <span className="sf-today__stat-value">
            <MoneyText paisa={approved.totalPaisa} size="lg" strong />
          </span>
          <span className="sf-today__stat-hint">{t('soFar.topupsCount', { count: approved.count })}</span>
        </li>
        <li className="sf-today__stat sf-today__stat--link">
          <Link to="/drivers" className="sf-today__stat-link">
            <span className="sf-today__stat-label">{t('soFar.drivers')}</span>
            <span className="sf-today__stat-value">
              {t('soFar.driversValue', { onDuty: formatNumber(summary.drivers.onDuty), total: formatNumber(summary.drivers.total) })}
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
}

function TodaySkeleton() {
  return (
    <div aria-hidden className="sf-today__skeleton">
      <ul className="sf-today__cards">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="sf-today__card">
            <div className="sf-today__card-head">
              <Skeleton width={40} height={40} radius="md" />
              <Skeleton width={48} height="1.8em" />
            </div>
            <Skeleton width="70%" />
            <Skeleton width="45%" />
            <Skeleton height={40} radius="md" />
          </li>
        ))}
      </ul>
      <ul className="sf-today__stats">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="sf-today__stat">
            <Skeleton width="60%" />
            <Skeleton width="40%" height="1.6em" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Today (UX_ADMIN §2.1, website spec W05): what needs the office now, as cards with one button each,
 * and today's totals, from `GET /admin/summary`. The same query feeds the navigation badges and the
 * browser-tab count, and refreshes every 20 seconds. The page has no primary button.
 */
export function TodayPage() {
  const { t } = useTranslation(['today', 'common']);
  const summary = useAdminSummary();
  const { config } = useAppConfig();
  const now = useNow(15_000);
  const staleness = useStaleness(summary);
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
          {cards.length > 0 ? (
            <ul className="sf-today__cards sf-today__section">
              {cards.map((card) => (
                <Card key={cardKey(card)} card={card} now={now} />
              ))}
            </ul>
          ) : (
            <p className="sf-today__clear sf-today__section" role="status">
              <CircleCheck aria-hidden size={20} strokeWidth={2.25} />
              {staleness.kind !== null && staleness.since
                ? t('allClear.stale', { time: formatTime(staleness.since) })
                : t('allClear.title')}
            </p>
          )}
          <SoFar summary={data} />
        </>
      )}
    </div>
  );
}
