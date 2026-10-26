import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { Skeleton } from './Skeleton';
import type { Tone } from './statusTones';

export interface TableColumn<T> {
  id: string;
  /** Sentence case, short (UX_ADMIN §1.4). */
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** `end` for money and counts. */
  align?: 'start' | 'end' | 'center';
  /**
   * 1 always shows; 2 hides under 1024 px; 3 hides under 1280 px (UX_ADMIN §1.3). Hidden columns must
   * also be in the record's drawer.
   */
  priority?: 1 | 2 | 3;
  width?: CSSProperties['inlineSize'];
  /** Keeps the column in view while the table scrolls sideways (the first column on tablets). */
  sticky?: boolean;
}

export type TableState = 'loading' | 'error' | 'ready';

export interface TableProps<T> {
  /** Read by screen readers (visually hidden). */
  caption: string;
  columns: readonly TableColumn<T>[];
  rows: readonly T[] | undefined;
  rowKey: (row: T) => string;
  /** Makes rows focusable; Enter or a click opens the record. */
  onRowClick?: (row: T) => void;
  /**
   * Which rows open a record when `onRowClick` is set (all of them by default). A row that doesn't open
   * isn't focusable and has no chevron, for example a refill row in a wallet's history.
   */
  canOpenRow?: (row: T) => boolean;
  /**
   * A muted chevron at the end of each row that opens a record (UX_ADMIN §1.3), unless that row has an
   * action button: pass a function to choose per row ("Review" on top-ups to check, a chevron on the rest).
   */
  chevron?: boolean | ((row: T) => boolean);
  /**
   * Day groups for event lists (the wallet history, the Activity log): rows are already in order, and a
   * header row ("Today", "Thu 22 Oct") starts each run of rows with the same label.
   */
  groupBy?: (row: T) => string;
  /** A 4 px edge on the row's start side, always paired with a text chip in a cell. */
  rowTone?: (row: T) => Tone | null | undefined;
  /** Highlights the row whose drawer is open. */
  selectedKey?: string | null;
  /**
   * The row that just changed: tinted `--primary-soft` while this holds its key. Pass `useFlashedRow()`
   * or the key from `useHighlight()`, which clear it after 2 seconds (ui/highlight.ts).
   */
  highlightKey?: string | null;
  state: TableState;
  /**
   * Shown instead of rows when ready and empty: one line of 8 words or fewer and at most one button.
   * The table then has no header row.
   */
  empty: ReactNode;
  /** Shown when `state` is error, usually an `<ErrorState onRetry />`, with no header row. */
  error?: ReactNode;
  /** Under the table, for example "Load more". */
  footer?: ReactNode;
  /** Skeleton rows while loading; 5 by default. */
  skeletonRows?: number;
  className?: string;
}

const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [role="switch"]';

function alignClass(align: TableColumn<unknown>['align']): string | undefined {
  if (align === 'end') return 'is-end';
  if (align === 'center') return 'is-center';
  return undefined;
}

function columnClass<T>(column: TableColumn<T>): string {
  return cx(
    column.priority === 2 && 'sf-col-p2',
    column.priority === 3 && 'sf-col-p3',
    column.sticky && 'is-sticky',
    alignClass(column.align),
  );
}

interface RowGroup<T> {
  label: string | null;
  rows: T[];
}

/** Consecutive rows with the same label share one group; without `groupBy` there is one group. */
function groupRows<T>(rows: readonly T[], groupBy: ((row: T) => string) | undefined): RowGroup<T>[] {
  if (!groupBy) return [{ label: null, rows: [...rows] }];
  const groups: RowGroup<T>[] = [];
  for (const row of rows) {
    const label = groupBy(row);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

/** A data table (UX_ADMIN §1.5). The page never scrolls sideways: a wide table scrolls inside its card. */
export function Table<T>({
  caption,
  columns,
  rows,
  rowKey,
  onRowClick,
  canOpenRow,
  chevron = false,
  groupBy,
  rowTone,
  selectedKey,
  highlightKey,
  state,
  empty,
  error,
  footer,
  skeletonRows = 5,
  className,
}: TableProps<T>) {
  const { t } = useTranslation();
  const hasChevron = chevron !== false;
  const span = columns.length + (hasChevron ? 1 : 0);
  const opens = (row: T) => Boolean(onRowClick) && (canOpenRow ? canOpenRow(row) : true);
  const showsChevron = (row: T) => opens(row) && (typeof chevron === 'function' ? chevron(row) : chevron);

  const open = (row: T, event: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>) => {
    if (!onRowClick) return;
    // Buttons and links inside a row do their own thing.
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    onRowClick(row);
  };

  const chevronCell = (show: boolean) =>
    hasChevron ? (
      <td className="sf-table__chevron" aria-hidden>
        {show ? <ChevronRight size={16} strokeWidth={2} /> : null}
      </td>
    ) : null;

  const renderRow = (row: T) => {
    const key = rowKey(row);
    const tone = rowTone?.(row);
    const clickable = opens(row);
    return (
      <tr
        key={key}
        className={cx(
          'sf-table__row',
          clickable && 'is-clickable',
          tone && `has-tone sf-tone-${tone}`,
          selectedKey === key && 'is-selected',
          highlightKey === key && 'is-highlighted',
        )}
        tabIndex={clickable ? 0 : undefined}
        aria-current={selectedKey === key ? 'true' : undefined}
        onClick={clickable ? (event) => open(row, event) : undefined}
        onKeyDown={
          clickable
            ? (event) => {
                if (event.key === 'Enter' && event.target === event.currentTarget) {
                  event.preventDefault();
                  open(row, event);
                }
              }
            : undefined
        }
      >
        {columns.map((column) => (
          <td key={column.id} className={columnClass(column)}>
            {column.cell(row)}
          </td>
        ))}
        {chevronCell(showsChevron(row))}
      </tr>
    );
  };

  const hasRows = state === 'ready' && rows !== undefined && rows.length > 0;
  // An empty or failed table has no header row: the EmptyState or ErrorState fills the card.
  const showHeader = state === 'loading' || hasRows;

  let bodies: ReactNode;
  if (state === 'loading') {
    bodies = (
      <tbody>
        {Array.from({ length: skeletonRows }, (_, i) => (
          <tr key={`skeleton-${i}`} className="sf-table__row is-skeleton" aria-hidden>
            {columns.map((column) => (
              <td key={column.id} className={columnClass(column)}>
                <Skeleton width={column.align === 'end' ? '60%' : '80%'} />
              </td>
            ))}
            {chevronCell(false)}
          </tr>
        ))}
      </tbody>
    );
  } else if (state === 'error' || !hasRows) {
    bodies = (
      <tbody>
        <tr className="sf-table__row is-message">
          <td colSpan={span}>{state === 'error' ? error : empty}</td>
        </tr>
      </tbody>
    );
  } else {
    bodies = groupRows(rows ?? [], groupBy).map((group, index) => (
      <tbody key={group.label === null ? 'rows' : `group-${index}`} className={group.label === null ? undefined : 'sf-table__group'}>
        {group.label === null ? null : (
          <tr className="sf-table__group-row">
            <th colSpan={span} scope="rowgroup" className="sf-table__group-label">
              {group.label}
            </th>
          </tr>
        )}
        {group.rows.map(renderRow)}
      </tbody>
    ));
  }

  return (
    <div className={cx('sf-table-card', className)}>
      {state === 'loading' ? (
        <span className="sr-only" role="status">
          {t('state.loading')}
        </span>
      ) : null}
      <div className="sf-table-scroll">
        <table className="sf-table" aria-busy={state === 'loading' || undefined}>
          <caption className="sr-only">{caption}</caption>
          {showHeader ? (
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.id} scope="col" className={columnClass(column)} style={{ inlineSize: column.width }}>
                    {column.header}
                  </th>
                ))}
                {hasChevron ? <th className="sf-table__chevron" aria-hidden /> : null}
              </tr>
            </thead>
          ) : null}
          {bodies}
        </table>
      </div>
      {footer ? <div className="sf-table__footer">{footer}</div> : null}
    </div>
  );
}
