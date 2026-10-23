import { useMemo } from 'react';
import { Paperclip, Receipt } from 'lucide-react';
import type { ExpenseDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, MoneyText, StatusChip, Table, type TableColumn } from '../../ui';
import { formatCalendarDate } from '../../i18n/format';

export interface ExpensesTableProps {
  rows: readonly ExpenseDto[] | undefined;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (expense: ExpenseDto) => void;
  /** Filters other than the dates are on: the empty state says so and offers to clear them. */
  filtered: boolean;
  onClearFilters: () => void;
  /** "Add expense" for the empty state. */
  onAdd: () => void;
  /** The row just saved: tinted for 2 seconds. */
  highlightKey?: string | null;
}

const THIS_YEAR = new Date().getUTCFullYear();

/** Removed expenses are struck through (with the "Removed" chip on the row). */
function struck(row: ExpenseDto): string | undefined {
  return row.voidedAt ? 'sf-expenses__struck' : undefined;
}

/**
 * The expense list (UX_ADMIN §2.7, website spec W33): Date · Type · Amount · Van and driver · Note
 * (with a paperclip when there is a receipt), newest first, with "Load more". A row opens the expense;
 * a removed one is struck through and carries the chip "Removed". The page shows a failed load.
 */
export function ExpensesTable({
  rows,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
  filtered,
  onClearFilters,
  onAdd,
  highlightKey,
}: ExpensesTableProps) {
  const { t } = useTranslation(['expenses', 'common']);

  const columns = useMemo<TableColumn<ExpenseDto>[]>(
    () => [
      {
        id: 'date',
        header: t('table.date'),
        sticky: true,
        cell: (row) => (
          <span className="sf-expenses__date">
            <span className={struck(row)}>
              {formatCalendarDate(row.expenseDate, { year: Number(row.expenseDate.slice(0, 4)) !== THIS_YEAR })}
            </span>
            {row.voidedAt ? <StatusChip kind="expense" value="VOIDED" /> : null}
          </span>
        ),
      },
      { id: 'type', header: t('table.type'), cell: (row) => <span className={struck(row)}>{row.type.name}</span> },
      {
        id: 'amount',
        header: t('table.amount'),
        align: 'end',
        cell: (row) => <MoneyText paisa={row.amountPaisa} className={struck(row)} />,
      },
      {
        id: 'vanDriver',
        header: t('table.vanDriver'),
        priority: 2,
        cell: (row) => {
          const parts = [row.vehicle?.plateNo, row.driver?.name].filter((part): part is string => Boolean(part));
          if (parts.length === 0) return <span className="sf-expenses__muted">{t('table.none')}</span>;
          return (
            <span className={struck(row)}>
              {parts.length === 2 ? t('table.vanAndDriver', { van: parts[0], driver: parts[1] }) : parts[0]}
            </span>
          );
        },
      },
      {
        id: 'note',
        header: t('table.note'),
        priority: 2,
        cell: (row) => (
          <span className="sf-expenses__note-row">
            <span className={`sf-expenses__note-cell ${struck(row) ?? ''}`} title={row.description}>
              {row.description}
            </span>
            {row.receiptFileId || row.receiptUrl ? (
              <span className="sf-expenses__clip" title={t('table.hasReceipt')}>
                <Paperclip aria-hidden size={14} strokeWidth={2} />
                <span className="sr-only">{t('table.hasReceipt')}</span>
              </span>
            ) : null}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <Table
      caption={t('table.caption')}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={onOpen}
      chevron
      rowTone={(row) => (row.voidedAt ? 'neutral' : null)}
      highlightKey={highlightKey}
      state={loading && !rows ? 'loading' : 'ready'}
      className="sf-expenses__table"
      empty={
        filtered ? (
          <EmptyState
            compact
            icon={Receipt}
            title={t('table.emptyFilteredBody')}
            action={<Button onClick={onClearFilters}>{t('common:actions.clearFilters')}</Button>}
          />
        ) : (
          <EmptyState compact icon={Receipt} title={t('table.emptyTitle')} action={<Button onClick={onAdd}>{t('page.add')}</Button>} />
        )
      }
      footer={
        hasMore ? (
          <Button variant="ghost" onClick={onLoadMore} loading={loadingMore}>
            {t('table.loadMore')}
          </Button>
        ) : undefined
      }
    />
  );
}
