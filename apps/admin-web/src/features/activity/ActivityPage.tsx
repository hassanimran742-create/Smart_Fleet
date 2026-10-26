import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { History } from 'lucide-react';
import type { AuditLogDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { ACTIVITY_AREAS, type ActivityArea, type ActivitySearch } from '../../app/search';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNow } from '../../hooks/useNow';
import { formatDayLabel, formatTime } from '../../i18n/format';
import {
  activityActor,
  Button,
  DateInput,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  PageHeader,
  presetRangeFrom,
  SearchSelect,
  Select,
  StaleBanner,
  Table,
  type FilterChipOption,
  type TableColumn,
} from '../../ui';
import { useDistributorDirectory } from '../prices/api';
import { historyToday } from '../wallets/historyDates';
import { useActivityLog, useActivityPeople, type ActivityPerson } from './api';
import { activityLine, activityTarget, activityWhy, areaOf, type ActivityTarget } from './sentences';
import './activity.css';

const route = getRouteApi('/activity');

/** Rows to show before "Look further back", and how many more each press asks for. */
const SHOW_STEP = 50;
/** Pages read by themselves to fill a "What" filter before asking the person to look further back. */
const AUTO_PAGES = 10;
/** Up to this many people "Who" is a list; more, a search box (website spec §1.4). */
const WHO_LIST_MAX = 15;

const DATE_PRESETS = ['today', 'last7', 'thisMonth', 'lastMonth'] as const;
type DateChoice = 'any' | (typeof DATE_PRESETS)[number] | 'custom';
type WhatChoice = 'all' | ActivityArea;

/** Which date chip the URL describes: none is "Any date"; a preset's exact range is that preset. */
function dateChoiceOf(search: ActivitySearch, customMode: boolean, today: string): DateChoice {
  if (!search.from && !search.to) return customMode ? 'custom' : 'any';
  if (customMode) return 'custom';
  for (const preset of DATE_PRESETS) {
    const range = presetRangeFrom(preset, today);
    if (range.from === search.from && range.to === search.to) return preset;
  }
  return 'custom';
}

/**
 * The Activity log (`/activity?what&who&from&to`, website spec W40): every audit row as a plain
 * sentence, by day, with who did it and why. The filters live in the URL: What and Date are chips, Who a
 * list. Who and the dates are filtered by the server, in business days (the date presets count from
 * the business date, as the wallet history does); What groups actions, so the page filters the rows it
 * has read and reads further back when a filter leaves few. Rows about an order, a top-up, a
 * distributor or a wallet open that record.
 */
export function ActivityPage() {
  const { t } = useTranslation(['activity', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const goTo = useNavigate();
  const { config } = useAppConfig();
  const now = useNow(60_000);
  const [customDates, setCustomDates] = useState(false);
  const what = search.what;

  const log = useActivityLog({ actorUserId: search.who, from: search.from, to: search.to });
  const people = useActivityPeople();
  const directory = useDistributorDirectory();

  const names = useMemo(() => new Map((directory.data ?? []).map((d) => [d.id, d.businessName])), [directory.data]);
  const context = useMemo(() => ({ distributorName: (id: string) => names.get(id) }), [names]);

  const pages = log.data?.pages;
  const pageCount = pages?.length ?? 0;
  const loaded = useMemo(() => (pages ?? []).flatMap((page) => page.items), [pages]);
  const rows = useMemo(() => (what ? loaded.filter((row) => areaOf(row.action) === what) : loaded), [loaded, what]);

  // How many rows the person wants to see, and how many pages had been read when they last asked.
  const [wanted, setWanted] = useState(SHOW_STEP);
  const [pagesWhenAsked, setPagesWhenAsked] = useState(0);
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;
  const filterKey = `${what ?? ''}|${search.who ?? ''}|${search.from ?? ''}|${search.to ?? ''}`;
  useEffect(() => {
    // A new filter starts a new budget of pages to read by themselves.
    setWanted(SHOW_STEP);
    setPagesWhenAsked(pageCountRef.current);
  }, [filterKey]);

  const budgetLeft = pageCount - pagesWhenAsked < AUTO_PAGES;
  const needMore = rows.length < wanted && log.hasNextPage === true;
  useEffect(() => {
    if (needMore && budgetLeft && !log.isFetching && !log.isError) void log.fetchNextPage();
  }, [needMore, budgetLeft, log]);

  const setSearch = (patch: Partial<ActivitySearch>) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };

  const askForMore = () => {
    setWanted(rows.length + SHOW_STEP);
    setPagesWhenAsked(pageCount);
  };

  // The server reads `from` and `to` as business days (03:00 cut-off), so the presets count from the
  // business date (DECIDED.md: presetRangeFrom(choice, historyToday(appConfig.day))).
  const today = historyToday(config.day);
  const dateChoice = dateChoiceOf(search, customDates, today);
  const onDateChoice = (choice: DateChoice) => {
    setCustomDates(choice === 'custom');
    if (choice === 'any') setSearch({ from: undefined, to: undefined });
    else if (choice !== 'custom') {
      const range = presetRangeFrom(choice, today);
      setSearch({ from: range.from, to: range.to });
    }
  };

  const clearFilters = () => {
    setCustomDates(false);
    void navigate({ search: {}, replace: true });
  };

  const open = useCallback(
    (row: AuditLogDto) => {
      const target: ActivityTarget | null = activityTarget(row);
      if (!target) return;
      if (target.kind === 'order') void goTo({ to: '/orders/$orderId', params: { orderId: target.id }, search: {} });
      else if (target.kind === 'topup') void goTo({ to: '/topups/$paymentId', params: { paymentId: target.id }, search: {} });
      else if (target.kind === 'wallet') void goTo({ to: '/wallets/$distributorId', params: { distributorId: target.id }, search: {} });
      else void goTo({ to: '/distributors/$id', params: { id: target.id } });
    },
    [goTo],
  );

  const filtered = Boolean(what || search.who || search.from || search.to || customDates);
  const scanning = needMore && budgetLeft && log.isFetchingNextPage;
  const showMoreButton = log.hasNextPage === true && (!needMore || !budgetLeft);

  const columns = useMemo<TableColumn<AuditLogDto>[]>(
    () => [
      {
        id: 'when',
        header: t('table.when'),
        width: '6.5rem',
        cell: (row) => (
          <time dateTime={row.at} className="sf-activity-log__when">
            {formatTime(row.at)}
          </time>
        ),
      },
      { id: 'who', header: t('table.who'), width: '10rem', cell: (row) => activityActor(row) },
      { id: 'what', header: t('table.what'), cell: (row) => activityLine(row, context) },
      {
        id: 'why',
        header: t('table.why'),
        // No reason: an empty cell, not a dash on most rows.
        cell: (row) => <span className="sf-activity-log__why">{activityWhy(row)}</span>,
      },
    ],
    [context, t],
  );

  const whatOptions: FilterChipOption<WhatChoice>[] = [
    { value: 'all', label: t('filters.anything') },
    ...ACTIVITY_AREAS.map((area) => ({ value: area, label: t(`areas.${area}`) })),
  ];
  const dateOptions: FilterChipOption<DateChoice>[] = [
    { value: 'any', label: t('filters.anyDate') },
    ...DATE_PRESETS.map((preset) => ({ value: preset, label: t(`common:dates.${preset}`) })),
    { value: 'custom', label: t('common:dates.custom') },
  ];

  const state = log.isPending ? 'loading' : log.isError && !log.data ? 'error' : 'ready';

  return (
    <div className="sf-activity-log">
      <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} />

      <div className="sf-activity-log__filters">
        <FilterChips<WhatChoice>
          label={t('filters.what')}
          options={whatOptions}
          value={what ?? 'all'}
          onChange={(next) => setSearch({ what: next === 'all' ? undefined : next })}
        />
        <div className="sf-activity-log__row">
          <Field label={t('filters.who')} labelHidden className="sf-activity-log__who">
            <WhoFilter people={people.data} loading={people.isPending} value={search.who ?? null} onChange={(who) => setSearch({ who: who ?? undefined })} />
          </Field>
          <FilterChips<DateChoice> label={t('filters.date')} options={dateOptions} value={dateChoice} onChange={onDateChoice} />
          {dateChoice === 'custom' ? (
            <span className="sf-activity-log__range">
              <DateInput
                aria-label={t('common:dates.from')}
                value={search.from ?? ''}
                max={search.to || undefined}
                onChange={(from) => setSearch({ from: from || undefined })}
              />
              <DateInput
                aria-label={t('common:dates.to')}
                value={search.to ?? ''}
                min={search.from || undefined}
                onChange={(to) => setSearch({ to: to || undefined })}
              />
            </span>
          ) : null}
        </div>
      </div>

      <StaleBanner query={log} />

      <Table
        caption={t('table.caption')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={open}
        canOpenRow={(row) => activityTarget(row) !== null}
        chevron
        groupBy={(row) => formatDayLabel(row.at, now)}
        state={state}
        error={<ErrorState error={log.error} onRetry={() => void log.refetch()} retrying={log.isFetching} title={t('page.loadFailed')} />}
        empty={
          scanning ? (
            <EmptyState compact title={t('more.scanning')} />
          ) : filtered ? (
            <EmptyState
              compact
              title={t('empty.filteredTitle')}
              action={
                <Button size="sm" onClick={clearFilters}>
                  {t('common:actions.clearFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState compact icon={History} title={t('empty.title')} />
          )
        }
        footer={
          state === 'ready' && (showMoreButton || scanning) ? (
            <Button variant="ghost" onClick={askForMore} loading={log.isFetchingNextPage}>
              {t('more.lookFurther')}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

interface WhoFilterProps {
  people: readonly ActivityPerson[] | undefined;
  loading: boolean;
  value: string | null;
  onChange: (id: string | null) => void;
}

/** "Anyone", then the office, distributors and drivers: a list, or a search box above 15 people. */
function WhoFilter({ people, loading, value, onChange }: WhoFilterProps) {
  const { t } = useTranslation('activity');
  const list = people ?? [];
  const groupOf = (role: ActivityPerson['role']) =>
    role === 'SUPER_ADMIN' ? t('filters.office') : role === 'DISTRIBUTOR' ? t('filters.distributors') : t('filters.drivers');
  const nameOf = (person: ActivityPerson) =>
    person.shopName ? t('filters.shopUser', { name: person.name, shop: person.shopName }) : person.name;

  if (list.length > WHO_LIST_MAX) {
    return (
      <SearchSelect
        options={list.map((person) => ({ value: person.id, label: nameOf(person), description: groupOf(person.role) }))}
        value={value}
        onChange={onChange}
        clearLabel={t('filters.anyone')}
        placeholder={t('filters.anyone')}
        loading={loading}
      />
    );
  }
  return (
    <Select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{t('filters.anyone')}</option>
      {(['SUPER_ADMIN', 'DISTRIBUTOR', 'DRIVER'] as const).map((role) => {
        const group = list.filter((person) => person.role === role);
        return group.length > 0 ? (
          <optgroup key={role} label={groupOf(role)}>
            {group.map((person) => (
              <option key={person.id} value={person.id}>
                {nameOf(person)}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </Select>
  );
}
