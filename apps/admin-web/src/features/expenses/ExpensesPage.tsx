import { useId, useMemo, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { Plus, Tags } from 'lucide-react';
import type { ExpenseDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { EXPENSES_TABS, type ExpensesSearch, type ExpensesTab } from '../../app/search';
import {
  Button,
  DateRangeFilter,
  Field,
  FilterBar,
  PageHeader,
  Select,
  Switch,
  Tabs,
  type DateRange,
  type SelectOption,
} from '../../ui';
import { useDrivers, useExpenseList, useExpenseSummary, useExpenseTypes, useVans } from './api';
import { ExpenseDrawer, type ExpenseDrawerState } from './ExpenseDrawer';
import { ExpenseTotals } from './ExpenseTotals';
import { ExpensesTable } from './ExpensesTable';
import { EXPENSE_DATE_PRESETS, filtersFor, hasListFilters, rangeFromSearch, searchForRange } from './filters';
import { FuelLogsTab } from './FuelLogsTab';
import './expenses.css';

const route = getRouteApi('/expenses');

/**
 * Expenses (UX_ADMIN §2.7): the office's running costs of vans and drivers, which never touch a
 * distributor's wallet. Tabs, dates and filters live in the URL (`?tab&from&to&type&van&driver&removed`).
 */
export function ExpensesPage() {
  const { t } = useTranslation(['expenses', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const tab: ExpensesTab = search.tab ?? EXPENSES_TABS[0];
  const [customDates, setCustomDates] = useState(false);
  const [includeFuel, setIncludeFuel] = useState(false);
  const [drawer, setDrawer] = useState<ExpenseDrawerState | null>(null);
  const removedSwitchId = useId();

  const range = rangeFromSearch(search, customDates);
  const filters = filtersFor(range, search);
  const dates = { from: filters.from, to: filters.to };

  const types = useExpenseTypes();
  const vans = useVans();
  const drivers = useDrivers();
  const summary = useExpenseSummary(dates);
  const list = useExpenseList(filters);

  const setSearch = (patch: Partial<ExpensesSearch>) => {
    void navigate({ to: '/expenses', search: (prev) => ({ ...prev, ...patch }), replace: true });
  };

  const onRangeChange = (next: DateRange) => {
    setCustomDates(next.preset === 'custom');
    setSearch(next.preset === 'custom' ? { from: next.from || undefined, to: next.to || undefined } : searchForRange(next));
  };

  const typeOptions = useMemo<SelectOption[]>(
    () =>
      (types.data ?? []).map((type) => ({
        value: type.id,
        label: type.archived ? t('filters.archivedOption', { name: type.name }) : type.name,
      })),
    [types.data, t],
  );
  const vanOptions = useMemo<SelectOption[]>(() => (vans.data ?? []).map((van) => ({ value: van.id, label: van.plateNo })), [vans.data]);
  const driverOptions = useMemo<SelectOption[]>(
    () => (drivers.data ?? []).map((driver) => ({ value: driver.id, label: driver.name })),
    [drivers.data],
  );

  const rows = useMemo<ExpenseDto[] | undefined>(() => list.data?.pages.flatMap((page) => page.items), [list.data]);
  const openAdd = () => setDrawer({ mode: 'add' });
  const openExpense = (expense: ExpenseDto) => setDrawer({ mode: 'edit', expense });

  return (
    <div className="sf-expenses">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        updatedAt={tab === 'expenses' ? summary.dataUpdatedAt || null : null}
        onRefresh={tab === 'expenses' ? () => void Promise.all([summary.refetch(), list.refetch()]) : undefined}
        refreshing={summary.isFetching || list.isFetching}
        primaryAction={
          <Button variant="primary" icon={Plus} onClick={openAdd} disabled={!types.data}>
            {t('page.add')}
          </Button>
        }
        secondaryActions={
          <ButtonLink to="/expenses/types" search={true} icon={Tags}>
            {t('page.manageTypes')}
          </ButtonLink>
        }
      />

      <Tabs
        label={t('page.tabsLabel')}
        items={[
          { id: 'expenses', label: t('tabs.expenses') },
          { id: 'fuel-logs', label: t('tabs.fuelLogs') },
        ]}
        value={tab}
        onChange={(next) => setSearch({ tab: next === EXPENSES_TABS[0] ? undefined : next })}
      />

      <FilterBar className="sf-expenses__filters">
        <DateRangeFilter value={range} onChange={onRangeChange} presets={EXPENSE_DATE_PRESETS} />
        {tab === 'expenses' ? (
          <Field label={t('filters.type')} labelHidden>
            <Select
              value={search.type ?? ''}
              placeholder={t('filters.allTypes')}
              options={typeOptions}
              onChange={(event) => setSearch({ type: event.target.value || undefined })}
            />
          </Field>
        ) : null}
        <Field label={t('filters.van')} labelHidden>
          <Select
            value={search.van ?? ''}
            placeholder={t('filters.allVans')}
            options={vanOptions}
            onChange={(event) => setSearch({ van: event.target.value || undefined })}
          />
        </Field>
        {tab === 'expenses' ? (
          <>
            <Field label={t('filters.driver')} labelHidden>
              <Select
                value={search.driver ?? ''}
                placeholder={t('filters.allDrivers')}
                options={driverOptions}
                onChange={(event) => setSearch({ driver: event.target.value || undefined })}
              />
            </Field>
            <div className="sf-expenses__switch-field">
              <Switch
                id={removedSwitchId}
                checked={search.removed === true}
                onChange={(on) => setSearch({ removed: on ? true : undefined })}
              />
              <label htmlFor={removedSwitchId} className="sf-expenses__switch-label">
                {t('filters.showRemoved')}
              </label>
            </div>
          </>
        ) : null}
      </FilterBar>

      {tab === 'expenses' ? (
        <>
          <ExpenseTotals
            summary={summary.data}
            types={types.data}
            loading={summary.isPending || types.isPending}
            error={summary.error ?? types.error}
            onRetry={() => void Promise.all([summary.refetch(), types.refetch()])}
            retrying={summary.isFetching || types.isFetching}
            includeFuel={includeFuel}
            onIncludeFuelChange={setIncludeFuel}
            listFiltered={hasListFilters(search)}
            range={dates}
          />
          <ExpensesTable
            rows={rows}
            loading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
            hasMore={list.hasNextPage}
            loadingMore={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            onOpen={openExpense}
            filtered={hasListFilters(search) || search.removed === true}
            onAdd={openAdd}
          />
        </>
      ) : (
        <FuelLogsTab range={dates} vanId={search.van} />
      )}

      {drawer && types.data ? <ExpenseDrawer state={drawer} types={types.data} onClose={() => setDrawer(null)} /> : null}
    </div>
  );
}
