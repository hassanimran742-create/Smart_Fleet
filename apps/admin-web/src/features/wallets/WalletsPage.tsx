import { useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { AdminWalletRow } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatRs } from '../../i18n/format';
import { EmptyState, ErrorState, MoneyText, PageHeader, StaleBanner, Table, type TableColumn } from '../../ui';
import { useWalletList } from './api';
import './wallets.css';

/**
 * Wallets (`/wallets`, UX_ADMIN §2.6): each distributor's one balance (no holds, ADR-06), the money in
 * top-ups being checked, and when their last top-up was approved. A row opens the wallet page.
 */
export function WalletsPage() {
  const { t } = useTranslation(['wallets', 'common']);
  const navigate = useNavigate();
  const list = useWalletList();

  const open = useCallback(
    (row: AdminWalletRow) => {
      void navigate({ to: '/wallets/$distributorId', params: { distributorId: row.distributorId } });
    },
    [navigate],
  );

  const columns = useMemo<TableColumn<AdminWalletRow>[]>(
    () => [
      {
        id: 'distributor',
        header: t('list.distributor'),
        sticky: true,
        cell: (row) => (
          <span className="sf-wallets__name">
            <span>{row.businessName}</span>
            <span className="sf-wallets__muted">{row.code}</span>
          </span>
        ),
      },
      { id: 'balance', header: t('list.balance'), align: 'end', cell: (row) => <MoneyText paisa={row.balancePaisa} strong /> },
      {
        id: 'checking',
        header: t('list.checking'),
        align: 'end',
        priority: 2,
        cell: (row) =>
          row.checkingCount > 0 ? (
            t('list.checkingValue', { count: row.checkingCount, amount: formatRs(row.checkingPaisa) })
          ) : (
            <span className="sf-wallets__muted">{t('list.none')}</span>
          ),
      },
      {
        id: 'lastTopup',
        header: t('list.lastTopup'),
        priority: 3,
        cell: (row) =>
          row.lastTopupAt ? (
            <time dateTime={row.lastTopupAt}>{formatDateTime(row.lastTopupAt)}</time>
          ) : (
            <span className="sf-wallets__muted">{t('list.noTopupYet')}</span>
          ),
      },
    ],
    [t],
  );

  return (
    <div className="sf-wallets">
      <PageHeader
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        updatedAt={list.dataUpdatedAt || null}
        onRefresh={() => void list.refetch()}
        refreshing={list.isFetching}
      />
      <StaleBanner query={list} />
      <Table
        caption={t('list.caption')}
        columns={columns}
        rows={list.data}
        rowKey={(row) => row.distributorId}
        onRowClick={open}
        state={list.isPending ? 'loading' : list.isError && !list.data ? 'error' : 'ready'}
        error={<ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} title={t('list.loadFailed')} />}
        empty={<EmptyState compact title={t('list.emptyTitle')} body={t('list.emptyBody')} />}
      />
    </div>
  );
}
