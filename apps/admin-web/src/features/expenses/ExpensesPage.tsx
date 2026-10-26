import { useMemo, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { Plus, Tags } from 'lucide-react';
import type { ExpenseDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { EXPENSES_TABS, type ExpensesSearch, type ExpensesTab } from '../../app/search';
import {
  Button,
  DateRangeFilter,
  ErrorState,
  Field,
  FilterBar,
  PageHeader,
  SearchSelect,
  Select,
  Tabs,
  ToggleChip,
  useFlashedRow,
  type DateRange,
  type SelectOption,
} from '../../ui';
import { useDrivers, useExpenseList, useExpenseSummary, useExpenseTypes, useVans } from './api';
import { ExpenseDrawer, type ExpenseDrawerState } from './ExpenseDrawer';
import { ExpenseTotals, ExpenseTotalsSkeleton } from './ExpenseTotals';
import { ExpensesTable } from './ExpensesTable';
import { EXPENSE_DATE_PRESETS, filtersFor, hasListFilters, rangeFromSearch, searchForRange } from './filters';
import { FuelLogsTab } from './FuelLogsTab';
import './expenses.css';

const route = getRouteApi('/expenses');

/** Up to this many vans or drivers are a Select; more get a search box (UX_ADMIN §1.4). */
const SELECT_MAX = 6;

interface PickFilterProps {
  label: string;
  allLabel: string;
  options: readonly SelectOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

/** A van or driver filter: a Select for a short list, a search box for a long one. */
function PickFilter({ label, allLabel, options, value, onChange }: PickFilterProps) {
  if (options.length > SELECT_MAX) {
    return (
      <div className="sf-expenses__pick">
        <SearchSelect
          label={label}
          placeholder={allLabel}
          clearLabel={allLabel}
          options={options}
          value={value ?? null}
          onChange={(next) => onChange(next ?? undefined)}
        />
      </div>
    );
  }
  return (
    <Field label={label} labelHidden>
      <Select value={value ?? ''} placeholder={allLabel} options={options} onChange={(event) => onChange(event.target.value || undefined)} />
    </Field>
  );
}

/**
 * Expenses (UX_ADMIN §2.7, website spec W33–W34): the office's running costs of vans and drivers, which
 * never touch a distributor's wallet. The date chips, then Type, Van, Driver and "Show removed"; the
 * totals (only types with expenses in the dates); the list. Tabs, dates and filters live in the URL
 * (`?tab&from&to&type&van&driver&removed`). A failed load is one error for the page.
 */
export function ExpensesPage() {
  const { t } = useTranslation(['expenses', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const tab: ExpensesTab = search.tab ?? EXPENSES_TABS[0];
  const [customDates, setCustomDates] = useState(false);
  const [includeFuel, setIncludeFuel] = useState(false);
  const [drawer, setDrawer] = useState<ExpenseDrawerState | null>(null);
  const flashed = useFlashedRow('expenses');

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

  const clearFilters = () => setSearch({ type: undefined, van: undefined, driver: undefined, removed: undefined });

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

  // One error for the page (website spec W33), not one per block.
  const failed = (summary.isError && !summary.data) || (list.isError && !list.data);

  return (
    <div className="sf-expenses">
      <PageHeader
        title={t('page.title')}
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

      <div className="sf-expenses__filters">
        <FilterBar>
          <DateRangeFilter value={range} onChange={onRangeChange} presets={EXPENSE_DATE_PRESETS} />
        </FilterBar>
        <FilterBar>
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
          <PickFilter
            label={t('filters.van')}
            allLabel={t('filters.allVans')}
            options={vanOptions}
            value={search.van}
            onChange={(van) => setSearch({ van })}
          />
          {tab === 'expenses' ? (
            <>
              <PickFilter
                label={t('filters.driver')}
                allLabel={t('filters.allDrivers')}
                options={driverOptions}
                value={search.driver}
                onChange={(driver) => setSearch({ driver })}
              />
              <ToggleChip
                label={t('filters.showRemoved')}
                pressed={search.removed === true}
                onChange={(on) => setSearch({ removed: on ? true : undefined })}
              />
            </>
          ) : null}
        </FilterBar>
      </div>

      {tab === 'expenses' ? (
        failed ? (
          <ErrorState
            error={list.error ?? summary.error}
            title={t('table.loadFailed')}
            onRetry={() => void Promise.all([summary.refetch(), list.refetch()])}
            retrying={summary.isFetching || list.isFetching}
          />
        ) : (
          <>
            {summary.data ? (
              <ExpenseTotals
                summary={summary.data}
                includeFuel={includeFuel}
                onIncludeFuelChange={setIncludeFuel}
                listFiltered={hasListFilters(search)}
                range={dates}
              />
            ) : (
              <ExpenseTotalsSkeleton />
            )}
            <ExpensesTable
              rows={rows}
              loading={list.isPending}
              hasMore={list.hasNextPage}
              loadingMore={list.isFetchingNextPage}
              onLoadMore={() => void list.fetchNextPage()}
              onOpen={openExpense}
              filtered={hasListFilters(search) || search.removed === true}
              onClearFilters={clearFilters}
              onAdd={openAdd}
              highlightKey={flashed}
            />
          </>
        )
      ) : (
        <FuelLogsTab range={dates} vanId={search.van} />
      )}

      {drawer && types.data ? <ExpenseDrawer state={drawer} types={types.data} onClose={() => setDrawer(null)} /> : null}
    </div>
  );
}
