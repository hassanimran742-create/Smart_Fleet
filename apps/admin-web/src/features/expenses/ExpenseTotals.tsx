import { useId, useMemo } from 'react';
import type { ExpenseSummary, ExpenseTypeDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, InlineAlert, MoneyText, Skeleton, Switch, Table, type TableColumn } from '../../ui';
import { formatRs } from '../../i18n/format';
import { spansMonths, splitMonth } from './filters';

export interface ExpenseTotalsProps {
  summary: ExpenseSummary | undefined;
  types: readonly ExpenseTypeDto[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  /** "Include driver fuel logs in totals": off by default, so a bill is never counted twice. */
  includeFuel: boolean;
  onIncludeFuelChange: (on: boolean) => void;
  /** The list below is filtered by type, van or driver: say the totals cover every expense. */
  listFiltered: boolean;
  range: { from: string; to: string };
}

interface TypeCard {
  typeId: string;
  name: string;
  totalPaisa: string;
  count: number;
}

/**
 * The totals of UX_ADMIN §2.7: one card per type (active types always, archived ones only with rows in
 * the range), the muted driver fuel-log card beside them, the grand total, the include switch, and the
 * month × type table for ranges longer than a month.
 */
export function ExpenseTotals({
  summary,
  types,
  loading,
  error,
  onRetry,
  retrying,
  includeFuel,
  onIncludeFuelChange,
  listFiltered,
  range,
}: ExpenseTotalsProps) {
  const { t } = useTranslation(['expenses', 'common']);
  const switchId = useId();

  const cards = useMemo<TypeCard[]>(() => {
    if (!summary) return [];
    const byId = new Map(summary.byType.map((row) => [row.typeId, row]));
    const out: TypeCard[] = [];
    for (const type of types ?? []) {
      const row = byId.get(type.id);
      if (type.archived && !row) continue;
      out.push({ typeId: type.id, name: row?.name ?? type.name, totalPaisa: row?.totalPaisa ?? '0', count: row?.count ?? 0 });
      byId.delete(type.id);
    }
    // A type the list doesn't know yet (added in another tab) still gets its card.
    for (const row of byId.values()) out.push({ typeId: row.typeId, name: row.name, totalPaisa: row.totalPaisa, count: row.count });
    return out;
  }, [summary, types]);

  if (error && !summary) {
    return (
      <section className="sf-expenses__section" aria-labelledby="expense-totals-title">
        <h2 id="expense-totals-title" className="sf-expenses__section-title">
          {t('totals.heading')}
        </h2>
        <ErrorState compact error={error} onRetry={onRetry} retrying={retrying} title={t('totals.loadFailed')} />
      </section>
    );
  }

  if (loading || !summary) {
    return (
      <section className="sf-expenses__section" aria-busy="true" aria-labelledby="expense-totals-title">
        <h2 id="expense-totals-title" className="sf-expenses__section-title">
          {t('totals.heading')}
        </h2>
        <div className="sf-expenses__cards">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="sf-expenses__card" aria-hidden>
              <Skeleton width="60%" />
              <Skeleton width="80%" height="1.6em" />
              <Skeleton width="40%" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const fuel = summary.fuelLogs;
  const grandTotal = includeFuel ? (BigInt(summary.totalPaisa) + BigInt(fuel.totalPaisa)).toString() : summary.totalPaisa;

  return (
    <section className="sf-expenses__section" aria-labelledby="expense-totals-title">
      <h2 id="expense-totals-title" className="sf-expenses__section-title">
        {t('totals.heading')}
      </h2>
      {listFiltered ? <p className="sf-expenses__note">{t('filters.totalsCoverAll')}</p> : null}
      <div className="sf-expenses__cards">
        {cards.map((card) => (
          <div key={card.typeId} className="sf-expenses__card">
            <span className="sf-expenses__card-title" title={card.name}>
              {card.name}
            </span>
            <MoneyText paisa={card.totalPaisa} size="lg" strong />
            <span className="sf-expenses__card-meta">{t('totals.count', { count: card.count })}</span>
          </div>
        ))}
        <div
          className="sf-expenses__card sf-expenses__card--fuel"
          aria-label={t('totals.fuelCardSummary', { count: fuel.count, amount: formatRs(fuel.totalPaisa) })}
          role="group"
        >
          <span className="sf-expenses__card-title" aria-hidden>
            {t('totals.fuelCardTitle')}
          </span>
          <span aria-hidden>
            <MoneyText paisa={fuel.totalPaisa} size="lg" />
          </span>
          <span className="sf-expenses__card-meta" aria-hidden>
            {t('totals.fuelCardCount', { count: fuel.count })}
          </span>
        </div>
        <div className="sf-expenses__card sf-expenses__card--total" aria-live="polite">
          <span className="sf-expenses__card-title">{includeFuel ? t('totals.totalWithFuel') : t('totals.total')}</span>
          <MoneyText paisa={grandTotal} size="lg" strong />
          <span className="sf-expenses__card-meta">{t('totals.count', { count: summary.count })}</span>
        </div>
      </div>
      <div className="sf-expenses__include">
        <Switch id={switchId} checked={includeFuel} onChange={onIncludeFuelChange} aria-describedby={`${switchId}-hint`} />
        <label htmlFor={switchId} className="sf-expenses__switch-label">
          {t('totals.includeFuel')}
        </label>
        <span id={`${switchId}-hint`} className="sf-expenses__include-hint">
          {t('totals.includeFuelHint')}
        </span>
      </div>
      {spansMonths(range) && summary.byMonth.length > 0 ? <MonthTable summary={summary} /> : null}
      {error ? (
        <InlineAlert
          tone="warning"
          action={
            <Button size="sm" onClick={onRetry} loading={retrying}>
              {t('common:actions.tryAgain')}
            </Button>
          }
        >
          {t('common:freshness.stale')}
        </InlineAlert>
      ) : null}
    </section>
  );
}

type MonthRow = ExpenseSummary['byMonth'][number];

/** Months down, types across (only types with rows in the range), with each month's total. */
function MonthTable({ summary }: { summary: ExpenseSummary }) {
  const { t } = useTranslation('expenses');
  const columns = useMemo<TableColumn<MonthRow>[]>(() => {
    const monthLabel = (month: string) => {
      const { key, year } = splitMonth(month);
      return t('months.label', { month: t(`months.names.${key}`), year });
    };
    return [
      { id: 'month', header: t('totals.month'), cell: (row) => monthLabel(row.month), sticky: true },
      ...summary.byType.map(
        (type): TableColumn<MonthRow> => ({
          id: type.typeId,
          header: type.name,
          align: 'end',
          cell: (row) => {
            const cell = row.byType.find((entry) => entry.typeId === type.typeId);
            return cell ? <MoneyText paisa={cell.totalPaisa} /> : <span className="sf-expenses__muted">{t('totals.none')}</span>;
          },
        }),
      ),
      { id: 'total', header: t('totals.monthTotal'), align: 'end', cell: (row) => <MoneyText paisa={row.totalPaisa} strong /> },
    ];
  }, [summary.byType, t]);

  return (
    <>
      <h3 className="sf-expenses__section-title">{t('totals.byMonthHeading')}</h3>
      <Table
        caption={t('totals.byMonthCaption')}
        columns={columns}
        rows={summary.byMonth}
        rowKey={(row) => row.month}
        state="ready"
        empty={null}
      />
    </>
  );
}
