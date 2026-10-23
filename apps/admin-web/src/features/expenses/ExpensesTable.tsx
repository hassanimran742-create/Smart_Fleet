import { useMemo } from 'react';
import type { ExpenseDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, ErrorState, MoneyText, StatusChip, Table, type TableColumn } from '../../ui';
import { formatCalendarDate } from '../../i18n/format';

export interface ExpensesTableProps {
  rows: readonly ExpenseDto[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (expense: ExpenseDto) => void;
  /** Filters other than the dates are on: the empty state says so. */
  filtered: boolean;
  /** "Add expense" for the empty state (a secondary button: the page's primary is in its header). */
  onAdd: () => void;
}

const THIS_YEAR = new Date().getUTCFullYear();

/** Removed expenses are struck through (with the "Removed" chip on the row). */
function struck(row: ExpenseDto): string | undefined {
  return row.voidedAt ? 'sf-expenses__struck' : undefined;
}

/**
 * The expense list (UX_ADMIN §2.7): Date · Type · Amount · Van · Driver · Note · Receipt · By, newest
 * first, with "Load more". A removed expense is struck through and carries the chip "Removed".
 */
export function ExpensesTable({
  rows,
  loading,
  error,
  onRetry,
  retrying,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
  filtered,
  onAdd,
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
        id: 'van',
        header: t('table.van'),
        priority: 2,
        cell: (row) => row.vehicle?.plateNo ?? <span className="sf-expenses__muted">{t('table.noVan')}</span>,
      },
      {
        id: 'driver',
        header: t('table.driver'),
        priority: 3,
        cell: (row) => row.driver?.name ?? <span className="sf-expenses__muted">{t('table.noDriver')}</span>,
      },
      {
        id: 'note',
        header: t('table.note'),
        priority: 2,
        cell: (row) => (
          <span className={`sf-expenses__note-cell ${struck(row) ?? ''}`} title={row.description}>
            {row.description}
          </span>
        ),
      },
      {
        id: 'receipt',
        header: t('table.receipt'),
        priority: 3,
        cell: (row) =>
          row.receiptUrl ? (
            <a
              className="sf-expenses__thumb-link"
              href={row.receiptUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={t('table.openReceipt')}
            >
              <img
                className="sf-expenses__thumb"
                src={row.receiptUrl}
                alt={t('table.receiptAlt', { note: row.description })}
                loading="lazy"
              />
            </a>
          ) : (
            <span className="sf-expenses__muted">{t('table.noReceipt')}</span>
          ),
      },
      { id: 'by', header: t('table.by'), priority: 3, cell: (row) => row.recordedBy.name },
    ],
    [t],
  );

  const state = error && !rows ? 'error' : loading && !rows ? 'loading' : 'ready';

  return (
    <Table
      caption={t('table.caption')}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={onOpen}
      rowTone={(row) => (row.voidedAt ? 'neutral' : null)}
      state={state}
      className="sf-expenses__table"
      empty={
        <EmptyState
          compact
          title={t('table.emptyTitle')}
          body={filtered ? t('table.emptyFilteredBody') : t('table.emptyBody')}
          action={<Button onClick={onAdd}>{t('page.add')}</Button>}
        />
      }
      error={<ErrorState compact error={error} onRetry={onRetry} retrying={retrying} title={t('table.loadFailed')} />}
      footer={
        hasMore ? (
          <Button onClick={onLoadMore} loading={loadingMore}>
            {t('table.loadMore')}
          </Button>
        ) : undefined
      }
    />
  );
}
