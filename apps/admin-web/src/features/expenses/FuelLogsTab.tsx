import { useMemo, useState } from 'react';
import { Fuel } from 'lucide-react';
import { addDays } from '@smartfleet/shared-utils';
import { useTranslation } from 'react-i18next';
import { useModule } from '../../app/modules';
import { formatDateTime, formatNumber } from '../../i18n/format';
import { EmptyState, ErrorState, MoneyText, Table, type TableColumn } from '../../ui';
import { useFuelConsumption, type FuelLog } from './api';
import { karachiDayStartIso } from './filters';

export interface FuelLogsTabProps {
  /** Inclusive Pakistan calendar dates. */
  range: { from: string; to: string };
  /** The van filter of the page, when set. */
  vanId?: string;
}

interface VanRow {
  vehicleId: string;
  plateNo: string;
  litres: number;
  costPaisa: string;
  km: number;
  kmPerLitre: number | null;
  logs: FuelLog[];
}

interface LogRow extends FuelLog {
  plateNo: string;
}

const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * The read-only Driver fuel logs tab (UX_ADMIN §2.7, website spec W34): `GET /reports/fuel-consumption`
 * per van (litres, cost, km, km per litre) with the logs inside. The report takes only a start, so the
 * end of the range is applied here, and each van's figures are worked out from the logs in the range,
 * the way the report works them out (km = last odometer − first). With no logs it is one empty line:
 * "Drivers can't log fuel yet." while the feature is off.
 */
export function FuelLogsTab({ range, vanId }: FuelLogsTabProps) {
  const { t } = useTranslation('expenses');
  const fuelModule = useModule('fuelRefills');
  const query = useFuelConsumption(karachiDayStartIso(range.from));
  const [selected, setSelected] = useState<string | null>(null);

  const vans = useMemo<VanRow[]>(() => {
    const endMs = Date.parse(karachiDayStartIso(addDays(range.to, 1)));
    const startMs = Date.parse(karachiDayStartIso(range.from));
    const rows: VanRow[] = [];
    for (const van of query.data ?? []) {
      if (vanId && van.vehicleId !== vanId) continue;
      const logs = van.refills
        .filter((log) => {
          const at = Date.parse(log.refillAt);
          return at >= startMs && at < endMs;
        })
        .sort((a, b) => Date.parse(a.refillAt) - Date.parse(b.refillAt));
      if (logs.length === 0) continue;
      const litres = logs.reduce((sum, log) => sum + Number(log.litres), 0);
      const costPaisa = logs.reduce((sum, log) => sum + BigInt(log.costPaisa), 0n).toString();
      const km = Math.max(0, logs[logs.length - 1].odometerKm - logs[0].odometerKm);
      rows.push({
        vehicleId: van.vehicleId,
        plateNo: van.plateNo,
        litres,
        costPaisa,
        km,
        kmPerLitre: litres > 0 && km > 0 ? Math.round((km / litres) * 100) / 100 : null,
        logs,
      });
    }
    return rows.sort((a, b) => a.plateNo.localeCompare(b.plateNo));
  }, [query.data, range.from, range.to, vanId]);

  const shown = selected ? vans.filter((van) => van.vehicleId === selected) : vans;
  const logs = useMemo<LogRow[]>(
    () =>
      shown
        .flatMap((van) => van.logs.map((log) => ({ ...log, plateNo: van.plateNo })))
        .sort((a, b) => Date.parse(b.refillAt) - Date.parse(a.refillAt)),
    [shown],
  );

  const vanColumns = useMemo<TableColumn<VanRow>[]>(
    () => [
      {
        id: 'van',
        header: t('fuel.van'),
        sticky: true,
        cell: (row) => <strong>{row.plateNo}</strong>,
      },
      { id: 'litres', header: t('fuel.litres'), align: 'end', cell: (row) => t('fuel.litresValue', { litres: decimal.format(row.litres) }) },
      { id: 'cost', header: t('fuel.cost'), align: 'end', cell: (row) => <MoneyText paisa={row.costPaisa} /> },
      { id: 'km', header: t('fuel.km'), align: 'end', cell: (row) => formatNumber(row.km) },
      {
        id: 'kmPerLitre',
        header: t('fuel.kmPerLitre'),
        align: 'end',
        cell: (row) => (row.kmPerLitre === null ? t('fuel.noValue') : decimal.format(row.kmPerLitre)),
      },
      { id: 'logs', header: t('fuel.logs'), align: 'end', priority: 2, cell: (row) => formatNumber(row.logs.length) },
    ],
    [t],
  );

  const logColumns = useMemo<TableColumn<LogRow>[]>(
    () => [
      { id: 'when', header: t('fuel.when'), cell: (row) => formatDateTime(row.refillAt) },
      { id: 'van', header: t('fuel.van'), cell: (row) => row.plateNo },
      { id: 'driver', header: t('fuel.driver'), cell: (row) => row.driverName },
      { id: 'litres', header: t('fuel.litres'), align: 'end', cell: (row) => t('fuel.litresValue', { litres: decimal.format(Number(row.litres)) }) },
      { id: 'cost', header: t('fuel.cost'), align: 'end', cell: (row) => <MoneyText paisa={row.costPaisa} /> },
      { id: 'odometer', header: t('fuel.odometer'), align: 'end', priority: 2, cell: (row) => formatNumber(row.odometerKm) },
      { id: 'station', header: t('fuel.station'), priority: 3, cell: (row) => row.fuelStation ?? t('fuel.noStation') },
    ],
    [t],
  );

  const state = query.isError && !query.data ? 'error' : query.isPending ? 'loading' : 'ready';
  const selectedVan = vans.find((van) => van.vehicleId === selected);

  return (
    <section className="sf-expenses__section" aria-label={t('fuel.caption')}>
      <Table
        caption={t('fuel.caption')}
        columns={vanColumns}
        rows={vans}
        rowKey={(row) => row.vehicleId}
        selectedKey={selected}
        onRowClick={(row) => setSelected((current) => (current === row.vehicleId ? null : row.vehicleId))}
        state={state}
        empty={
          <EmptyState
            compact
            icon={Fuel}
            title={!fuelModule.loading && !fuelModule.enabled ? t('fuel.switchedOff') : t('fuel.emptyTitle')}
          />
        }
        error={
          <ErrorState
            compact
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
            title={t('fuel.loadFailed')}
          />
        }
      />
      {state === 'ready' && logs.length > 0 ? (
        <>
          <h3 className="sf-expenses__section-title">
            {selectedVan ? t('fuel.logsCaption', { van: selectedVan.plateNo }) : t('fuel.allLogsCaption')}
          </h3>
          <Table
            caption={selectedVan ? t('fuel.logsCaption', { van: selectedVan.plateNo }) : t('fuel.allLogsCaption')}
            columns={logColumns}
            rows={logs}
            rowKey={(row) => row.id}
            state="ready"
            empty={null}
          />
        </>
      ) : null}
    </section>
  );
}
