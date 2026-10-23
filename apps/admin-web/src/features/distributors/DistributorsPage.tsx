import { useId, useMemo } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { Plus, Store } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { formatPhone } from '../../i18n/format';
import {
  Chip,
  EmptyState,
  ErrorState,
  FilterBar,
  MoneyText,
  PageHeader,
  StaleBanner,
  StatusChip,
  Switch,
  Table,
  type TableColumn,
} from '../../ui';
import { useDistributors } from './api';
import './distributors.css';

const route = getRouteApi('/distributors');

/** "10 of 10", or the warning chip "8 of 10" when a zone has no price (UX_ADMIN §2.4). */
export function PriceCoverage({ prices }: { prices: DistributorDto['prices'] }) {
  const { t } = useTranslation('distributors');
  const text = t('list.pricesValue', { priced: prices.priced, total: prices.total });
  if (prices.total > 0 && prices.priced < prices.total) return <Chip tone="warning">{text}</Chip>;
  return <span className="sf-dist__nowrap">{text}</span>;
}

/**
 * Distributors (`/distributors`, UX_ADMIN §2.4): each one with its code, phone, store and zone, status,
 * balance and price coverage. Suspended distributors are hidden unless "Show suspended" is on. The Add
 * drawer is the child route `/distributors/new`.
 */
export function DistributorsPage() {
  const { t } = useTranslation(['distributors', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const switchId = useId();
  const query = useDistributors();
  const showSuspended = search.suspended === true;

  const rows = useMemo(() => {
    const list = [...(query.data ?? [])].sort((a, b) => a.businessName.localeCompare(b.businessName));
    return showSuspended ? list : list.filter((d) => d.status !== 'SUSPENDED');
  }, [query.data, showSuspended]);

  const columns = useMemo<TableColumn<DistributorDto>[]>(
    () => [
      {
        id: 'distributor',
        header: t('list.columns.distributor'),
        cell: (d) => (
          <span className="sf-dist__two-line">
            <span className="sf-dist__strong">{d.businessName}</span>
            <span className="sf-dist__muted">{d.contact.name}</span>
          </span>
        ),
        priority: 1,
        sticky: true,
      },
      { id: 'code', header: t('list.columns.code'), cell: (d) => <span className="sf-dist__code">{d.code}</span>, priority: 2 },
      {
        id: 'phone',
        header: t('list.columns.phone'),
        cell: (d) => <span className="sf-dist__nowrap">{formatPhone(d.contact.phone)}</span>,
        priority: 1,
      },
      {
        id: 'store',
        header: t('list.columns.store'),
        cell: (d) =>
          d.store ? (
            <span className="sf-dist__two-line">
              <span>{d.store.name}</span>
              <span className="sf-dist__muted">{d.store.zone.name}</span>
            </span>
          ) : (
            <Chip tone="warning">{t('list.noStore')}</Chip>
          ),
        priority: 1,
      },
      { id: 'status', header: t('list.columns.status'), cell: (d) => <StatusChip kind="distributor" value={d.status} />, priority: 1 },
      {
        id: 'balance',
        header: t('list.columns.balance'),
        cell: (d) => <MoneyText paisa={d.wallet.balancePaisa} />,
        align: 'end',
        priority: 2,
      },
      { id: 'prices', header: t('list.columns.prices'), cell: (d) => <PriceCoverage prices={d.prices} />, priority: 2 },
    ],
    [t],
  );

  const hiddenSuspended = !showSuspended && (query.data ?? []).some((d) => d.status === 'SUSPENDED');
  const empty =
    hiddenSuspended && rows.length === 0 ? (
      <EmptyState compact icon={Store} title={t('list.allSuspended.title')} body={t('list.allSuspended.body')} />
    ) : (
      <EmptyState
        compact
        icon={Store}
        title={t('list.empty.title')}
        body={t('list.empty.body')}
        action={
          <ButtonLink to="/distributors/new" search={true} variant="primary" icon={Plus}>
            {t('list.add')}
          </ButtonLink>
        }
      />
    );

  return (
    <div className="sf-dist">
      <PageHeader
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        updatedAt={query.dataUpdatedAt || null}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isPending}
        primaryAction={
          <ButtonLink to="/distributors/new" search={true} variant="primary" icon={Plus}>
            {t('list.add')}
          </ButtonLink>
        }
      />
      <FilterBar>
        <div className="sf-dist__switch">
          <Switch
            id={switchId}
            checked={showSuspended}
            onChange={(on) =>
              void navigate({ to: '/distributors', search: (prev) => ({ ...prev, suspended: on ? true : undefined }), replace: true })
            }
          />
          <label htmlFor={switchId} className="sf-dist__switch-label">
            {t('list.showSuspended')}
          </label>
        </div>
      </FilterBar>
      <StaleBanner query={query} />
      <Table<DistributorDto>
        caption={t('list.caption')}
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        onRowClick={(d) => void navigate({ to: '/distributors/$id', params: { id: d.id } })}
        rowTone={(d) => (d.status === 'PENDING' ? 'warning' : d.status === 'SUSPENDED' ? 'danger' : null)}
        state={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
        empty={empty}
        error={
          <ErrorState
            compact
            error={query.error}
            title={t('list.loadFailed')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        }
      />
    </div>
  );
}
