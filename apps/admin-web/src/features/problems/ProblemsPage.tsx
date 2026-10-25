import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import type { CaseDto, Page } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  StaleBanner,
  Table,
  useToast,
  WaitTime,
  type TableColumn,
} from '../../ui';
import { useDistributors } from '../distributors/api';
import { AnswerChip } from './answer';
import { problemKeys, useOpenProblems } from './api';
import { ResolveDialog } from './ResolveDialog';
import './problems.css';

/** A problem waiting this long shows its wait as a warning, as a top-up does (UX_ADMIN §3.3). */
const WARN_AFTER_MIN = 60;

/** Drops one problem from the cached list, so its row leaves at once (the refetch confirms it). */
function withoutProblem(data: InfiniteData<Page<CaseDto>> | undefined, id: string): InfiniteData<Page<CaseDto>> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((item) => item.id !== id) })) };
}

/**
 * Customer problems (`/problems`, UX_ADMIN §3.3, Inc 2/3 spec §3.1): the open problems, oldest first,
 * from `GET /alerts?type=CUSTOMER_PROBLEM&status=OPEN`. It refreshes itself every 20 seconds, like the
 * other queues. Each row has one action, "Mark as sorted…"; the order number opens the order drawer,
 * which has the customer's phone, the cylinders and the link. No tabs, filters or primary button: the
 * page lists open problems only, and there are few. No money on this page (ADR-15).
 */
export function ProblemsPage() {
  const { t } = useTranslation(['problems', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useOpenProblems();
  const distributors = useDistributors();
  const [sorting, setSorting] = useState<CaseDto | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  /** After a close, the focus moves to the next row's button once the row has left. */
  const pendingFocus = useRef<{ id: string; index: number } | null>(null);

  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.items), [query.data]);
  // With more than one distributor, the distributor sits muted under the order number.
  const many = (distributors.data?.length ?? 0) > 1;

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !rows || rows.some((row) => row.id === pending.id)) return;
    pendingFocus.current = null;
    const buttons = tableRef.current?.querySelectorAll<HTMLButtonElement>('[data-problem-action]');
    const next = buttons && buttons.length > 0 ? buttons[Math.min(pending.index, buttons.length - 1)] : undefined;
    if (next) next.focus();
    else document.getElementById('main')?.focus();
  }, [rows]);

  const onSorted = (problem: CaseDto) => {
    pendingFocus.current = { id: problem.id, index: Math.max(0, rows?.findIndex((row) => row.id === problem.id) ?? 0) };
    queryClient.setQueryData<InfiniteData<Page<CaseDto>>>(problemKeys.open(), (data) => withoutProblem(data, problem.id));
    toast.success(t('sort.toast', { no: problem.order.shortCode }));
    setSorting(null);
  };

  const columns = useMemo<TableColumn<CaseDto>[]>(
    () => [
      {
        id: 'waiting',
        header: t('columns.waiting'),
        cell: (problem) => <WaitTime since={problem.openedAt} warnAfterMin={WARN_AFTER_MIN} />,
        priority: 1,
      },
      {
        id: 'order',
        header: t('columns.order'),
        cell: (problem) => (
          <span className="sf-problems__two-line">
            <Link
              to="/orders/$orderId"
              params={{ orderId: problem.order.id }}
              className="sf-record-no sf-problems__order"
              aria-label={t('openOrder', { no: problem.order.shortCode })}
            >
              {problem.order.shortCode}
            </Link>
            {many ? <span className="sf-problems__muted">{problem.distributor.businessName}</span> : null}
          </span>
        ),
        priority: 1,
        sticky: true,
      },
      { id: 'customer', header: t('columns.customer'), cell: (problem) => problem.customerName, priority: 1 },
      { id: 'answer', header: t('columns.answer'), cell: (problem) => <AnswerChip value={problem.answer} />, priority: 1 },
      {
        id: 'note',
        header: t('columns.note'),
        cell: (problem) =>
          problem.comment ? (
            <span className="sf-problems__note">{t('quoted', { note: problem.comment })}</span>
          ) : (
            <span className="sf-problems__muted">{t('noNote')}</span>
          ),
        priority: 2,
      },
      {
        id: 'action',
        header: <span className="sr-only">{t('action')}</span>,
        align: 'end',
        cell: (problem) => (
          <Button
            size="sm"
            data-problem-action
            aria-label={t('actionFor', { no: problem.order.shortCode })}
            onClick={() => setSorting(problem)}
          >
            {t('action')}
          </Button>
        ),
        priority: 1,
      },
    ],
    [many, t],
  );

  return (
    <div className="sf-problems">
      <PageHeader
        title={t('title')}
        updatedAt={query.dataUpdatedAt || null}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isPending}
      />
      <StaleBanner query={query} />

      <div ref={tableRef}>
        <Table<CaseDto>
          caption={t('caption')}
          columns={columns}
          rows={rows}
          rowKey={(problem) => problem.id}
          state={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
          empty={<EmptyState compact icon={CircleCheck} title={t('empty.title')} />}
          error={
            <ErrorState
              compact
              error={query.error}
              title={t('loadFailed')}
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
            />
          }
          footer={
            query.hasNextPage ? (
              <Button variant="ghost" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
                {t('common:actions.loadMore')}
              </Button>
            ) : null
          }
        />
      </div>

      {sorting ? <ResolveDialog problem={sorting} onClose={() => setSorting(null)} onSorted={onSorted} /> : null}
    </div>
  );
}
