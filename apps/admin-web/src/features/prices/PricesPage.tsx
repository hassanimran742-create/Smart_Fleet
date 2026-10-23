import { useCallback, useId, useMemo } from 'react';
import { getRouteApi, useParams } from '@tanstack/react-router';
import type { PriceGridDto, PriceGridZone } from '@smartfleet/shared-types';
import { formatPkDay } from '@smartfleet/shared-utils';
import { useTranslation } from 'react-i18next';
import type { PricesSearch } from '../../app/search';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  InlineAlert,
  MoneyText,
  PageHeader,
  SkeletonText,
  StaleBanner,
  StatusChip,
  Switch,
  Table,
  type TableColumn,
} from '../../ui';
import { useDistributorDirectory, usePriceGrid } from './api';
import { DistributorSwitcher, switcherOptions } from './DistributorSwitcher';
import './prices.css';

const route = getRouteApi('/prices/$distributorId');

/**
 * Delivery prices (`/prices/$distributorId?missing&archived`, UX_ADMIN §2.3): one row per zone with the
 * base per order and the per-size amounts ("—" for 0), and "Set" or "Not set" in words. A missing price
 * is flagged by an alert that counts the zones. A row opens the price drawer.
 */
export function PricesPage() {
  const { t } = useTranslation(['prices', 'common']);
  const { distributorId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const params = useParams({ strict: false }) as { zoneId?: string };
  const grid = usePriceGrid(distributorId);
  const directory = useDistributorDirectory();
  const missingSwitchId = useId();
  const archivedSwitchId = useId();

  const data = grid.data;
  const options = useMemo(
    () =>
      switcherOptions(
        directory.data ?? [],
        data ? { id: data.distributor.id, name: data.distributor.businessName, coverage: data.coverage } : null,
      ),
    [directory.data, data],
  );

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
  const columns = usePriceColumns(data, open);
  const missing = data ? data.coverage.total - data.coverage.priced : 0;
  const hasArchived = Boolean(data?.zones.some((row) => !row.zone.isActive));
  const missingSwitch = (
    <span className="sf-prices__switch">
      <Switch id={missingSwitchId} checked={search.missing === true} onChange={(on) => setSearch({ missing: on ? true : undefined })} />
      <label htmlFor={missingSwitchId}>{t('showMissing')}</label>
    </span>
  );

  return (
    <div className="sf-prices">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        updatedAt={grid.dataUpdatedAt || null}
        onRefresh={() => void Promise.all([grid.refetch(), directory.refetch()])}
        refreshing={grid.isFetching}
      />

      <DistributorSwitcher options={options} currentId={distributorId} />

      {grid.isPending ? (
        <SkeletonText lines={2} />
      ) : data && missing > 0 ? (
        <InlineAlert tone="warning" className="sf-prices__missing" action={missingSwitch}>
          {t('missing', { count: missing, total: data.coverage.total, distributor: data.distributor.businessName })}
        </InlineAlert>
      ) : null}

      {hasArchived || (search.missing && missing === 0) ? (
        <div className="sf-prices__filters">
          {search.missing && missing === 0 ? missingSwitch : null}
          {hasArchived ? (
            <span className="sf-prices__switch">
              <Switch
                id={archivedSwitchId}
                checked={search.archived === true}
                onChange={(on) => setSearch({ archived: on ? true : undefined })}
              />
              <label htmlFor={archivedSwitchId}>{t('showArchived')}</label>
            </span>
          ) : null}
        </div>
      ) : null}

      <StaleBanner query={grid} />

      <Table
        caption={t('grid.caption', { distributor: data?.distributor.businessName ?? '' })}
        className="sf-prices__grid"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.zone.id}
        onRowClick={open}
        selectedKey={params.zoneId ?? null}
        rowTone={(row) => (row.zone.isActive && row.price === null ? 'warning' : null)}
        state={grid.isPending ? 'loading' : grid.isError && !data ? 'error' : 'ready'}
        error={<ErrorState error={grid.error} onRetry={() => void grid.refetch()} retrying={grid.isFetching} title={t('page.loadFailed')} />}
        empty={
          data && data.zones.length > 0 && search.missing ? (
            <EmptyState compact title={t('empty.missingTitle')} body={t('empty.missingBody')} />
          ) : (
            <EmptyState compact title={t('empty.zonesTitle')} body={t('empty.zonesBody')} />
          )
        }
      />
    </div>
  );
}

/** Active zones (and archived ones when asked); "Show only missing" keeps active zones without a price. */
function visibleRows(data: PriceGridDto | undefined, search: PricesSearch): PriceGridZone[] | undefined {
  if (!data) return undefined;
  return data.zones.filter((row) => {
    if (search.missing) return row.zone.isActive && row.price === null;
    return row.zone.isActive || search.archived === true;
  });
}

function usePriceColumns(data: PriceGridDto | undefined, open: (row: PriceGridZone) => void): TableColumn<PriceGridZone>[] {
  const { t } = useTranslation('prices');
  return useMemo(() => {
    const none = <span className="sf-prices__muted">{t('grid.none')}</span>;
    const sizes = data?.sizes ?? [];
    const columns: TableColumn<PriceGridZone>[] = [
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
      ...sizes.map(
        (size): TableColumn<PriceGridZone> => ({
          id: `size-${size.cylinderTypeId}`,
          header: (
            <span className="sf-prices__size-head">
              <span>{size.label}</span>
              <span className="sf-prices__muted">{t('grid.perCylinder')}</span>
            </span>
          ),
          align: 'end',
          cell: (row) => {
            const amount = row.price?.sizes.find((entry) => entry.cylinderTypeId === size.cylinderTypeId)?.perCylinderPaisa;
            return amount && amount !== '0' ? <MoneyText paisa={amount} /> : none;
          },
        }),
      ),
      {
        id: 'status',
        header: t('grid.status'),
        // Hidden under 1024 px (UX_ADMIN §2.3); the row's edge, its "Set price" button and the drawer say it.
        priority: 2,
        cell: (row) => <StatusChip kind="price" value={row.price ? 'SET' : 'NOT_SET'} />,
      },
      {
        id: 'changed',
        header: t('grid.changed'),
        priority: 3,
        cell: (row) =>
          row.price ? (
            row.price.updatedBy?.name ? (
              t('grid.changedBy', { date: formatPkDay(row.price.updatedAt, { weekday: false }), name: row.price.updatedBy.name })
            ) : (
              formatPkDay(row.price.updatedAt, { weekday: false })
            )
          ) : (
            none
          ),
      },
      {
        id: 'action',
        header: <span className="sr-only">{t('grid.action')}</span>,
        align: 'end',
        cell: (row) =>
          row.zone.isActive ? (
            <Button size="sm" variant={row.price ? 'ghost' : 'secondary'} onClick={() => open(row)}>
              {row.price ? t('grid.edit') : t('grid.set')}
            </Button>
          ) : row.price ? (
            <Button size="sm" variant="ghost" onClick={() => open(row)}>
              {t('grid.view')}
            </Button>
          ) : null,
      },
    ];
    return columns;
  }, [data?.sizes, open, t]);
}
