import { useCallback, useMemo } from 'react';
import { getRouteApi, useParams } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import type { PriceGridDto, PriceGridSize, PriceGridZone } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import type { PricesSearch } from '../../app/search';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterChips,
  InlineAlert,
  MoneyText,
  PageHeader,
  Skeleton,
  StaleBanner,
  StatusChip,
  Table,
  ToggleChip,
  useFlashedRow,
  type TableColumn,
} from '../../ui';
import { PRICES_FLASH, useDistributorDirectory, usePriceGrid } from './api';
import { DistributorSwitcher, switcherOptions } from './DistributorSwitcher';
import { sizeAmounts } from './example';
import './prices.css';

const route = getRouteApi('/prices/$distributorId');

type ZoneFilter = 'all' | 'missing';

/**
 * Delivery prices (`/prices/$distributorId?missing&archived`, website spec W15): the distributor chips
 * with their missing count, one red line when a zone has no price, the All zones / Missing chips, and a
 * 5-column grid (zone, base per order, per cylinder, status, a button). A row opens the price drawer.
 */
export function PricesPage() {
  const { t } = useTranslation(['prices', 'common']);
  const { distributorId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const params = useParams({ strict: false }) as { zoneId?: string };
  const grid = usePriceGrid(distributorId);
  const directory = useDistributorDirectory();
  const flashed = useFlashedRow(PRICES_FLASH);

  const data = grid.data;
  const options = useMemo(
    () =>
      switcherOptions(
        directory.data ?? [],
        data ? { id: data.distributor.id, name: data.distributor.businessName, coverage: data.coverage } : null,
      ),
    [directory.data, data],
  );
  const name = data?.distributor.businessName ?? options.find((option) => option.id === distributorId)?.name ?? null;

  const setSearch = (patch: Partial<PricesSearch>) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  const open = useCallback(
    (row: PriceGridZone) => {
      void navigate({ to: '/prices/$distributorId/$zoneId', params: { distributorId, zoneId: row.zone.id }, search: (prev) => prev });
    },
    [distributorId, navigate],
  );

  const rows = useMemo(() => visibleRows(data, search), [data, search]);
  const columns = usePriceColumns(data?.sizes, open);
  const missing = data ? Math.max(0, data.coverage.total - data.coverage.priced) : 0;
  const hasArchived = Boolean(data?.zones.some((row) => !row.zone.isActive));
  const zoneFilter: ZoneFilter = search.missing ? 'missing' : 'all';

  const empty =
    data && data.zones.some((row) => row.zone.isActive) && search.missing ? (
      <EmptyState
        compact
        icon={CircleCheck}
        title={t('empty.missingTitle')}
        action={
          <Button size="sm" onClick={() => setSearch({ missing: undefined })}>
            {t('empty.showAll')}
          </Button>
        }
      />
    ) : (
      <EmptyState compact title={t('empty.zonesTitle')} />
    );

  return (
    <div className="sf-prices">
      <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} />
      <StaleBanner query={grid} />

      {directory.isPending && !data ? (
        <div className="sf-chips sf-prices__switcher" aria-hidden>
          <Skeleton width="10rem" height="var(--control-h)" radius="pill" />
          <Skeleton width="10rem" height="var(--control-h)" radius="pill" />
        </div>
      ) : (
        <DistributorSwitcher options={options} currentId={distributorId} />
      )}
      {directory.isError && !directory.data ? (
        <InlineAlert
          tone="warning"
          className="sf-prices__alert"
          action={
            <Button size="sm" onClick={() => void directory.refetch()} loading={directory.isFetching}>
              {t('common:actions.tryAgain')}
            </Button>
          }
        >
          {t('index.loadFailed')}
        </InlineAlert>
      ) : null}

      {missing > 0 ? (
        <InlineAlert tone="danger" className="sf-prices__alert">
          {t('missing', { count: missing })}
        </InlineAlert>
      ) : null}

      {data && data.zones.length > 0 ? (
        <FilterBar className="sf-prices__filters">
          <FilterChips<ZoneFilter>
            label={t('filters.label')}
            options={[
              { value: 'all', label: t('filters.all') },
              { value: 'missing', label: t('filters.missing', { count: missing }) },
            ]}
            value={zoneFilter}
            onChange={(next) => setSearch({ missing: next === 'missing' ? true : undefined })}
          />
          {hasArchived ? (
            <ToggleChip
              label={t('showArchived')}
              pressed={search.archived === true}
              onChange={(on) => setSearch({ archived: on ? true : undefined })}
            />
          ) : null}
        </FilterBar>
      ) : null}

      <Table
        caption={t('grid.caption', { distributor: name ?? '' })}
        className="sf-prices__grid"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.zone.id}
        onRowClick={open}
        selectedKey={params.zoneId ?? null}
        highlightKey={flashed}
        rowTone={(row) => (row.zone.isActive && row.price === null ? 'danger' : null)}
        state={grid.isPending ? 'loading' : grid.isError && !data ? 'error' : 'ready'}
        error={
          <ErrorState
            error={grid.error}
            onRetry={() => void grid.refetch()}
            retrying={grid.isFetching}
            title={name ? t('page.loadFailedFor', { distributor: name }) : t('index.loadFailed')}
          />
        }
        empty={empty}
      />
    </div>
  );
}

/** Active zones (and archived ones when asked); Missing keeps the active zones without a price. */
function visibleRows(data: PriceGridDto | undefined, search: PricesSearch): PriceGridZone[] | undefined {
  if (!data) return undefined;
  return data.zones.filter((row) => {
    if (search.missing) return row.zone.isActive && row.price === null;
    return row.zone.isActive || search.archived === true;
  });
}

function usePriceColumns(sizes: readonly PriceGridSize[] | undefined, open: (row: PriceGridZone) => void): TableColumn<PriceGridZone>[] {
  const { t } = useTranslation('prices');
  return useMemo<TableColumn<PriceGridZone>[]>(() => {
    const none = <span className="sf-prices__muted">{t('grid.none')}</span>;
    return [
      {
        id: 'zone',
        header: t('grid.zone'),
        sticky: true,
        cell: (row) => (
          <span className="sf-prices__zone">
            <span className="sf-prices__zone-name">{row.zone.name}</span>
            <span className="sf-prices__muted">{row.zone.cityName}</span>
            {!row.zone.isActive ? <Chip tone="neutral">{t('grid.archived')}</Chip> : null}
          </span>
        ),
      },
      {
        id: 'base',
        header: t('grid.base'),
        align: 'end',
        cell: (row) => (row.price ? <MoneyText paisa={row.price.basePaisa} /> : none),
      },
      {
        id: 'perCylinder',
        header: t('grid.perCylinder'),
        cell: (row) => {
          const parts = sizeAmounts(row.price, sizes ?? []);
          if (parts.length === 0) return none;
          // "11.8 kg Rs 40 · 45.4 kg Rs 150": each size with its amount stays on one line.
          return (
            <span className="sf-prices__sizes-cell">
              {parts.map((part, index) => (
                <span key={part} className="sf-prices__size-amount">
                  {index > 0 ? <span aria-hidden>· </span> : null}
                  {part}
                </span>
              ))}
            </span>
          );
        },
      },
      {
        id: 'status',
        header: t('grid.status'),
        // Hidden under 1024 px (UX_ADMIN §2.3); the row's red edge, its "Set price" button and the drawer say it.
        priority: 2,
        cell: (row) => <StatusChip kind="price" value={row.price ? 'SET' : 'NOT_SET'} />,
      },
      {
        id: 'action',
        header: <span className="sr-only">{t('grid.action')}</span>,
        align: 'end',
        cell: (row) =>
          row.zone.isActive || row.price ? (
            <Button size="sm" variant="secondary" onClick={() => open(row)}>
              {!row.zone.isActive ? t('grid.view') : row.price ? t('grid.edit') : t('grid.set')}
            </Button>
          ) : null,
      },
    ];
  }, [open, sizes, t]);
}
