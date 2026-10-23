import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Search, Store } from 'lucide-react';
import type { AdminWalletRow } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { formatDateTime, formatRs } from '../../i18n/format';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  FilterBar,
  MoneyText,
  PageHeader,
  SearchField,
  StaleBanner,
  Table,
  type TableColumn,
} from '../../ui';
import { useWalletList } from './api';
import './wallets.css';

/** The name search shows only for a longer list (website spec W12). */
const SEARCH_FROM = 10;

/**
 * Wallets (`/wallets`, website spec W12): each distributor's one balance (no holds, ADR-06), with a red
 * "Low" chip under the low-balance warning, the money in top-ups to check (a link to them) and when
 * their last top-up was approved. A row opens the wallet page.
 */
export function WalletsPage() {
  const { t } = useTranslation(['wallets', 'common']);
  const navigate = useNavigate();
  const list = useWalletList();
  const [query, setQuery] = useState('');

  const all = list.data;
  const searchable = (all?.length ?? 0) > SEARCH_FROM;
  const typed = searchable ? query.trim().toLowerCase() : '';
  const rows = useMemo(
    () => (all && typed ? all.filter((row) => row.businessName.toLowerCase().includes(typed)) : all),
    [all, typed],
  );

  const open = useCallback(
    (row: AdminWalletRow) => {
      void navigate({ to: '/wallets/$distributorId', params: { distributorId: row.distributorId }, search: {} });
    },
    [navigate],
  );

  const columns = useMemo<TableColumn<AdminWalletRow>[]>(() => {
    const none = <span className="sf-wallets__muted">{t('list.none')}</span>;
    return [
      { id: 'distributor', header: t('list.distributor'), sticky: true, cell: (row) => row.businessName },
      {
        id: 'balance',
        header: t('list.balance'),
        align: 'end',
        cell: (row) => (
          <span className="sf-wallets__balance">
            {row.lowBalance ? <Chip tone="danger">{t('list.low')}</Chip> : null}
            <MoneyText paisa={row.balancePaisa} strong className="sf-wallets__amount" />
          </span>
        ),
      },
      {
        id: 'checking',
        header: t('list.checking'),
        align: 'end',
        cell: (row) =>
          row.checkingCount > 0 ? (
            <Link to="/topups" search={{ tab: 'to-check', q: row.businessName }} className="sf-wallets__link">
              {t('list.checkingValue', { count: row.checkingCount, amount: formatRs(row.checkingPaisa) })}
            </Link>
          ) : (
            none
          ),
      },
      {
        id: 'lastTopup',
        header: t('list.lastTopup'),
        priority: 3,
        cell: (row) => (row.lastTopupAt ? <time dateTime={row.lastTopupAt}>{formatDateTime(row.lastTopupAt)}</time> : none),
      },
    ];
  }, [t]);

  const empty = typed ? (
    <EmptyState
      compact
      icon={Search}
      title={t('list.searchEmpty', { q: query.trim() })}
      action={
        <Button size="sm" onClick={() => setQuery('')}>
          {t('common:actions.clearSearch')}
        </Button>
      }
    />
  ) : (
    <EmptyState
      compact
      icon={Store}
      title={t('list.emptyTitle')}
      action={
        <ButtonLink to="/distributors/new" variant="primary" icon={Plus}>
          {t('list.emptyAction')}
        </ButtonLink>
      }
    />
  );

  return (
    <div className="sf-wallets">
      <PageHeader title={t('list.title')} subtitle={t('list.subtitle')} />
      <StaleBanner query={list} />
      {searchable ? (
        <FilterBar>
          <SearchField value={query} onChange={setQuery} placeholder={t('list.search')} />
        </FilterBar>
      ) : null}
      <Table
        caption={t('list.caption')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.distributorId}
        onRowClick={open}
        chevron
        state={list.isPending ? 'loading' : list.isError && !list.data ? 'error' : 'ready'}
        error={<ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} title={t('list.loadFailed')} />}
        empty={empty}
      />
    </div>
  );
}
