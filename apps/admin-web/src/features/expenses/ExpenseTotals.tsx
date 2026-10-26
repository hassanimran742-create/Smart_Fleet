import { useMemo } from 'react';
import type { ExpenseSummary } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { formatRs } from '../../i18n/format';
import { MoneyText, Skeleton, Table, ToggleChip, type TableColumn } from '../../ui';
import { spansMonths, splitMonth } from './filters';

export interface ExpenseTotalsProps {
  summary: ExpenseSummary;
  /** "Add driver fuel logs": off by default, so a bill is never counted twice. */
  includeFuel: boolean;
  onIncludeFuelChange: (on: boolean) => void;
  /** The list below is filtered by type, van or driver: say the totals count every expense. */
  listFiltered: boolean;
  range: { from: string; to: string };
}

/**
 * The totals of UX_ADMIN §2.7 (website spec W33): the Total first, in the highlighted card, then one card
 * per type that has expenses in these dates (no Rs 0 cards). Only when drivers logged fuel in the dates:
 * the muted fuel-log card and the "Add driver fuel logs" chip, off by default. The month × type table
 * shows for ranges longer than a month.
 */
export function ExpenseTotals({ summary, includeFuel, onIncludeFuelChange, listFiltered, range }: ExpenseTotalsProps) {
  const { t } = useTranslation(['expenses', 'common']);
  const fuel = summary.fuelLogs;
  const hasFuel = fuel.count > 0;
  const withFuel = includeFuel && hasFuel;
  const grandTotal = withFuel ? (BigInt(summary.totalPaisa) + BigInt(fuel.totalPaisa)).toString() : summary.totalPaisa;
  const cards = summary.byType.filter((row) => row.count > 0);

  return (
    <section className="sf-expenses__section" aria-label={t('totals.label')}>
      {listFiltered ? <p className="sf-expenses__note">{t('filters.totalsCoverAll')}</p> : null}
      <div className="sf-expenses__cards">
        <div className="sf-expenses__card sf-expenses__card--total" aria-live="polite">
          <span className="sf-expenses__card-title">{withFuel ? t('totals.totalWithFuel') : t('totals.total')}</span>
          <MoneyText paisa={grandTotal} size="lg" strong />
          <span className="sf-expenses__card-meta">{t('totals.count', { count: summary.count })}</span>
        </div>
        {cards.map((card) => (
          <div key={card.typeId} className="sf-expenses__card">
            <span className="sf-expenses__card-title" title={card.name}>
              {card.name}
            </span>
            <MoneyText paisa={card.totalPaisa} size="lg" strong />
            <span className="sf-expenses__card-meta">{t('totals.count', { count: card.count })}</span>
          </div>
        ))}
        {hasFuel ? (
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
        ) : null}
      </div>
      {hasFuel ? (
        <div className="sf-expenses__include">
          <ToggleChip
            label={t('totals.includeFuel')}
            pressed={includeFuel}
            onChange={onIncludeFuelChange}
            aria-describedby={includeFuel ? undefined : 'expense-include-fuel-hint'}
          />
          {includeFuel ? null : (
            <span id="expense-include-fuel-hint" className="sf-expenses__include-hint">
              {t('totals.includeFuelHint')}
            </span>
          )}
        </div>
      ) : null}
      {spansMonths(range) && summary.byMonth.length > 0 ? <MonthTable summary={summary} /> : null}
    </section>
  );
}

/** Card skeletons while the totals load. */
export function ExpenseTotalsSkeleton() {
  return (
    <div className="sf-expenses__section" aria-hidden>
      <div className="sf-expenses__cards">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="sf-expenses__card">
            <Skeleton width="60%" />
            <Skeleton width="80%" height="1.6em" />
            <Skeleton width="40%" />
          </div>
        ))}
      </div>
    </div>
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
      ...summary.byType
        .filter((type) => type.count > 0)
        .map(
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
