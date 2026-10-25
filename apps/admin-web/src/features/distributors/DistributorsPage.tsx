import { useMemo } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { Plus, SearchX, Store } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { formatPhone } from '../../i18n/format';
import {
  AppChip,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  FilterBar,
  MoneyText,
  PageHeader,
  SearchField,
  StaleBanner,
  StatusChip,
  Table,
  ToggleChip,
  useFlashedRow,
  type TableColumn,
} from '../../ui';
import { useDistributors } from './api';
import './distributors.css';

const route = getRouteApi('/distributors');

/** The price chip of a distributor (UX_ADMIN §2.4): red "1 not set", or green "All set". */
export function PriceCoverage({ prices }: { prices: DistributorDto['prices'] }) {
  const { t } = useTranslation('distributors');
  if (prices.total === 0) return <span className="sf-dist__muted">—</span>;
  const missing = Math.max(0, prices.total - prices.priced);
  return missing > 0 ? (
    <Chip tone="danger">{t('list.pricesMissing', { count: missing })}</Chip>
  ) : (
    <Chip tone="success">{t('list.pricesAllSet')}</Chip>
  );
}

/** Digits a person may type for a phone: "0300 123" and "300123" both find "+92 300 1234567". */
function phoneDigits(text: string): string {
  return text.replace(/\D/g, '').replace(/^0092/, '').replace(/^92(?=\d{4,})/, '').replace(/^0+/, '');
}

/** True when a distributor matches the search: its name, contact, code or phone. */
function matches(distributor: DistributorDto, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${distributor.businessName} ${distributor.contact.name} ${distributor.code}`.toLowerCase();
  if (words.every((word) => text.includes(word))) return true;
  const digits = phoneDigits(query);
  return digits.length >= 3 && phoneDigits(distributor.contact.phone).includes(digits);
}

/** Waiting to start first (they need the office), then by name. */
function byNeed(a: DistributorDto, b: DistributorDto): number {
  const wa = a.status === 'PENDING' ? 0 : 1;
  const wb = b.status === 'PENDING' ? 0 : 1;
  return wa - wb || a.businessName.localeCompare(b.businessName);
}

/**
 * Distributors (`/distributors`, UX_ADMIN §2.4, website spec W18): find one by name, phone or code, or
 * add one. Waiting-to-start rows come first. Suspended distributors are hidden behind the "Show
 * suspended" chip, which shows only when there is one. The Add drawer is the child route
 * `/distributors/new`; a row opens the distributor's page.
 */
export function DistributorsPage() {
  const { t } = useTranslation(['distributors', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const query = useDistributors();
  const flashed = useFlashedRow('distributors');
  const q = search.q ?? '';
  const setQ = (next: string) =>
    void navigate({ to: '/distributors', search: (prev) => ({ ...prev, q: next.trim() ? next : undefined }), replace: true });
  const showSuspended = search.suspended === true;
  const hasSuspended = (query.data ?? []).some((d) => d.status === 'SUSPENDED');

  const rows = useMemo(() => {
    const list = [...(query.data ?? [])].sort(byNeed);
    const visible = showSuspended ? list : list.filter((d) => d.status !== 'SUSPENDED');
    return q ? visible.filter((d) => matches(d, q)) : visible;
  }, [query.data, showSuspended, q]);

  const columns = useMemo<TableColumn<DistributorDto>[]>(
    () => [
      {
        id: 'distributor',
        header: t('list.columns.distributor'),
        cell: (d) => (
          <span className="sf-dist__two-line">
            <span className="sf-dist__strong">{d.businessName}</span>
            {d.contact.name.trim().toLowerCase() !== d.businessName.trim().toLowerCase() ? (
              <span className="sf-dist__muted">{d.contact.name}</span>
            ) : null}
          </span>
        ),
        priority: 1,
        sticky: true,
      },
      {
        id: 'phone',
        header: t('list.columns.phone'),
        cell: (d) => <span className="sf-dist__nowrap">{formatPhone(d.contact.phone)}</span>,
        priority: 1,
      },
      {
        id: 'status',
        header: t('list.columns.status'),
        cell: (d) => (
          <span className="sf-dist__chips">
            <StatusChip kind="distributor" value={d.status} />
            {d.store ? null : <Chip tone="danger">{t('list.noStore')}</Chip>}
            <AppChip app={d.app} active={d.status !== 'SUSPENDED'} />
          </span>
        ),
        priority: 1,
      },
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

  const addButton = (
    <ButtonLink to="/distributors/new" search={true} variant="primary" icon={Plus}>
      {t('list.add')}
    </ButtonLink>
  );

  let empty;
  if (q) {
    empty = (
      <EmptyState
        compact
        icon={SearchX}
        title={t('list.searchEmpty', { q })}
        action={<Button onClick={() => setQ('')}>{t('common:actions.clearSearch')}</Button>}
      />
    );
  } else if (hasSuspended && !showSuspended) {
    // Every distributor is suspended: the "Show suspended" chip above is the way in.
    empty = <EmptyState compact icon={Store} title={t('list.allSuspended.title')} />;
  } else {
    empty = <EmptyState compact icon={Store} title={t('list.empty.title')} action={addButton} />;
  }

  return (
    <div className="sf-dist">
      <PageHeader title={t('list.title')} primaryAction={addButton} />
      <StaleBanner query={query} />
      {(query.data?.length ?? 0) > 0 ? (
        <FilterBar>
          <SearchField value={q} onChange={setQ} placeholder={t('list.search')} />
          {hasSuspended ? (
            <ToggleChip
              label={t('list.showSuspended')}
              pressed={showSuspended}
              onChange={(on) =>
                void navigate({ to: '/distributors', search: (prev) => ({ ...prev, suspended: on ? true : undefined }), replace: true })
              }
            />
          ) : null}
        </FilterBar>
      ) : null}
      <Table<DistributorDto>
        caption={t('list.caption')}
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        onRowClick={(d) => void navigate({ to: '/distributors/$id', params: { id: d.id } })}
        chevron
        rowTone={(d) => (d.status === 'PENDING' ? 'warning' : d.status === 'SUSPENDED' ? 'danger' : null)}
        highlightKey={flashed}
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
