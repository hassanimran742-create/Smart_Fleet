import { useEffect, useMemo, useRef, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import type { AuditLogDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { ACTIVITY_AREAS, type ActivityArea, type ActivitySearch } from '../../app/search';
import { formatDateTime } from '../../i18n/format';
import {
  activityActor,
  Button,
  DateInput,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  PageHeader,
  presetRange,
  Select,
  StaleBanner,
  Table,
  type DatePreset,
  type TableColumn,
} from '../../ui';
import { useDistributorDirectory } from '../prices/api';
import { useActivityLog, useActivityPeople, type ActivityPerson } from './api';
import { activityLine, activityWhy, areaOf } from './sentences';
import './activity.css';

const route = getRouteApi('/activity');

/** Rows to show before "Load more", and how many more each press asks for. */
const SHOW_STEP = 50;
/** Pages read by themselves to fill a "What" filter before asking the person to look further back. */
const AUTO_PAGES = 10;

type DateChoice = 'any' | Exclude<DatePreset, 'custom'> | 'custom';
const DATE_PRESETS = ['today', 'last7', 'thisMonth', 'lastMonth'] as const;

/** Which date choice the URL describes: none is "Any date"; a preset's exact range is that preset. */
function dateChoiceOf(search: ActivitySearch, customMode: boolean): DateChoice {
  if (!search.from && !search.to) return customMode ? 'custom' : 'any';
  if (customMode) return 'custom';
  for (const preset of DATE_PRESETS) {
    const range = presetRange(preset);
    if (range.from === search.from && range.to === search.to) return preset;
  }
  return 'custom';
}

/**
 * The Activity log (UX_ADMIN §2.9): every audit row as a plain sentence, with who did it and why.
 * Filters (What, Who, Date) live in the URL. Who and the dates are filtered by the server; What groups
 * actions, so the page filters the rows it has read and reads further back when a filter leaves few.
 */
export function ActivityPage() {
  const { t } = useTranslation(['activity', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
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

  const dateChoice = dateChoiceOf(search, customDates);
  const onDateChoice = (choice: DateChoice) => {
    setCustomDates(choice === 'custom');
    if (choice === 'any') setSearch({ from: undefined, to: undefined });
    else if (choice !== 'custom') {
      const range = presetRange(choice);
      setSearch({ from: range.from, to: range.to });
    }
  };

  const filtered = Boolean(what || search.who || search.from || search.to);
  const scanning = needMore && budgetLeft && log.isFetchingNextPage;

  const columns = useMemo<TableColumn<AuditLogDto>[]>(
    () => [
      {
        id: 'when',
        header: t('table.when'),
        width: '9.5rem',
        cell: (row) => (
          <time dateTime={row.at} className="sf-activity-log__when">
            {formatDateTime(row.at)}
          </time>
        ),
      },
      { id: 'who', header: t('table.who'), width: '10rem', cell: (row) => activityActor(row) },
      { id: 'what', header: t('table.what'), cell: (row) => activityLine(row, context) },
      {
        id: 'why',
        header: t('table.why'),
        cell: (row) => {
          const why = activityWhy(row);
          return why ? <span className="sf-activity-log__why">{why}</span> : <span className="sf-activity-log__muted">{t('table.none')}</span>;
        },
      },
    ],
    [context, t],
  );

  const state = log.isPending ? 'loading' : log.isError && !log.data ? 'error' : 'ready';
  const showMoreButton = log.hasNextPage === true && (!needMore || !budgetLeft);

  return (
    <div className="sf-activity-log">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        updatedAt={log.dataUpdatedAt || null}
        onRefresh={() => void log.refetch()}
        refreshing={log.isFetching && !log.isFetchingNextPage}
      />

      <FilterBar className="sf-activity-log__filters">
        <Field label={t('filters.what')}>
          <Select
            value={what ?? ''}
            placeholder={t('filters.anything')}
            options={ACTIVITY_AREAS.map((area) => ({ value: area, label: t(`areas.${area}`) }))}
            onChange={(event) => setSearch({ what: (event.target.value || undefined) as ActivityArea | undefined })}
          />
        </Field>
        <Field label={t('filters.who')}>
          <Select value={search.who ?? ''} onChange={(event) => setSearch({ who: event.target.value || undefined })}>
            <option value="">{t('filters.anyone')}</option>
            <PeopleGroup label={t('filters.office')} people={people.data} role="SUPER_ADMIN" />
            <PeopleGroup label={t('filters.shops')} people={people.data} role="DISTRIBUTOR" />
            <PeopleGroup label={t('filters.drivers')} people={people.data} role="DRIVER" />
          </Select>
        </Field>
        <Field label={t('filters.date')}>
          <Select
            value={dateChoice}
            options={[
              { value: 'any', label: t('filters.anyDate') },
              ...DATE_PRESETS.map((preset) => ({ value: preset, label: t(`common:dates.${preset}`) })),
              { value: 'custom', label: t('common:dates.custom') },
            ]}
            onChange={(event) => onDateChoice(event.target.value as DateChoice)}
          />
        </Field>
        {dateChoice === 'custom' ? (
          <>
            <Field label={t('common:dates.from')}>
              <DateInput
                value={search.from ?? ''}
                max={search.to || undefined}
                onChange={(from) => setSearch({ from: from || undefined })}
              />
            </Field>
            <Field label={t('common:dates.to')}>
              <DateInput value={search.to ?? ''} min={search.from || undefined} onChange={(to) => setSearch({ to: to || undefined })} />
            </Field>
          </>
        ) : null}
      </FilterBar>

      <StaleBanner query={log} />

      <Table
        caption={t('table.caption')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        state={state}
        error={<ErrorState error={log.error} onRetry={() => void log.refetch()} retrying={log.isFetching} title={t('page.loadFailed')} />}
        empty={
          scanning ? (
            <EmptyState compact title={t('more.scanning')} />
          ) : (
            <EmptyState
              compact
              title={filtered ? t('empty.filteredTitle') : t('empty.title')}
              body={filtered ? t('empty.filteredBody') : t('empty.body')}
              action={
                showMoreButton ? (
                  <Button onClick={askForMore} loading={log.isFetchingNextPage}>
                    {t('more.lookFurther')}
                  </Button>
                ) : undefined
              }
            />
          )
        }
        footer={
          rows.length > 0 && (showMoreButton || scanning) ? (
            <Button variant="ghost" onClick={askForMore} loading={log.isFetchingNextPage}>
              {needMore ? t('more.lookFurther') : t('common:actions.loadMore')}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

function PeopleGroup({ label, people, role }: { label: string; people: readonly ActivityPerson[] | undefined; role: ActivityPerson['role'] }) {
  const { t } = useTranslation('activity');
  const list = (people ?? []).filter((person) => person.role === role);
  if (list.length === 0) return null;
  return (
    <optgroup label={label}>
      {list.map((person) => (
        <option key={person.id} value={person.id}>
          {person.shopName ? t('filters.shopUser', { name: person.name, shop: person.shopName }) : person.name}
        </option>
      ))}
    </optgroup>
  );
}
