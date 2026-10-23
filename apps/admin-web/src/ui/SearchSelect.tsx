import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { TextInput } from './Field';
import { useOverlay } from './overlay';

export interface SearchSelectOption {
  value: string;
  /** What the row says and what the box shows once picked: "DHA Phase 1 · Lahore". */
  label: string;
  /** A muted second line, for example "Rs 5,000 · Approved". */
  description?: string;
  disabled?: boolean;
}

interface SearchSelectBaseProps {
  options: readonly SearchSelectOption[];
  /** Says what can be found: "Area or city". */
  placeholder?: string;
  /** Names the box when it isn't inside a `<Field>`. */
  label?: string;
  /** How many options show before anything is typed; 8. Typing searches all of them. */
  initialCount?: number;
  /** The options are still loading: the list says "Loading…". */
  loading?: boolean;
  /**
   * Which options match what was typed. By default every typed word must appear in the label or the
   * description, ignoring case. Pass `() => true` when the options already come filtered from the server.
   */
  filter?: (option: SearchSelectOption, query: string) => boolean;
  /** Called as the person types, for options that come from the server. */
  onQueryChange?: (query: string) => void;
  disabled?: boolean;
  name?: string;
  id?: string;
  /** Called when the focus leaves the box. */
  onBlur?: () => void;
  className?: string;
}

export interface SearchSelectSingleProps extends SearchSelectBaseProps {
  multiple?: false;
  value: string | null;
  onChange: (value: string | null) => void;
  /** A first row that clears the choice, for example "All distributors" (it calls `onChange(null)`). */
  clearLabel?: string;
}

export interface SearchSelectMultipleProps extends SearchSelectBaseProps {
  /** Several picks, shown as chips under the box with a remove button each (the zone's areas). */
  multiple: true;
  value: readonly string[];
  onChange: (value: string[]) => void;
}

export type SearchSelectProps = SearchSelectSingleProps | SearchSelectMultipleProps;

const DEFAULT_INITIAL = 8;
/** The panel's height in px (its max-height in components.css), to decide whether it opens upwards. */
const PANEL_SPACE = 280;
const CLEAR_ROW = '__clear__';

function defaultFilter(option: SearchSelectOption, query: string): boolean {
  const haystack = `${option.label} ${option.description ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

interface Row {
  key: string;
  option: SearchSelectOption | null;
}

/**
 * The website's "picker with search" (UX_ADMIN §1.4, UX_PRINCIPLES §3) for lists too long for chips:
 * more than 6 distributors, drivers or vans, the store's area, a correction's linked record, Activity
 * "Who". A search box over a list (a combobox): ↑ ↓ move, Enter picks, Esc closes; with nothing typed it
 * shows the first 8, and "No matches" when nothing fits.
 */
export function SearchSelect(props: SearchSelectProps) {
  const {
    options,
    placeholder,
    label,
    initialCount = DEFAULT_INITIAL,
    loading = false,
    filter = defaultFilter,
    onQueryChange,
    disabled = false,
    name,
    id,
    onBlur,
    className,
  } = props;
  const { t } = useTranslation();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');

  const picked = props.multiple ? new Set(props.value) : new Set(props.value === null ? [] : [props.value]);
  const selected = !props.multiple && props.value !== null ? options.find((option) => option.value === props.value) : undefined;
  const clearLabel = props.multiple ? undefined : props.clearLabel;

  const rows = useMemo<Row[]>(() => {
    const typed = query.trim();
    const matching = typed ? options.filter((option) => filter(option, typed)) : options.slice(0, initialCount);
    const list: Row[] = matching.map((option) => ({ key: option.value, option }));
    if (clearLabel && !typed) list.unshift({ key: CLEAR_ROW, option: null });
    return list;
  }, [options, query, filter, initialCount, clearLabel]);

  const pickable = (row: Row | undefined) => Boolean(row && !row.option?.disabled);

  // Keep the active row on something that can be picked, and in view.
  useEffect(() => {
    if (!open) return;
    const first = rows.findIndex(pickable);
    setActive((current) => (pickable(rows[current]) ? current : Math.max(first, 0)));
  }, [open, rows]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    if (disabled || open) return;
    const box = rootRef.current?.getBoundingClientRect();
    if (box) {
      const below = window.innerHeight - box.bottom;
      setPlacement(below < PANEL_SPACE && box.top > below ? 'up' : 'down');
    }
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    onQueryChange?.('');
  };

  // Esc closes only the list, never the drawer or dialog around it.
  useOverlay(rootRef, open, { onEscape: close, escapeOnly: true });

  const choose = (row: Row | undefined) => {
    if (!row || !pickable(row)) return;
    if (props.multiple) {
      const value = row.option?.value;
      if (value === undefined) return;
      props.onChange(picked.has(value) ? props.value.filter((v) => v !== value) : [...props.value, value]);
      setQuery('');
      onQueryChange?.('');
      return;
    }
    props.onChange(row.option ? row.option.value : null);
    close();
  };

  const move = (step: 1 | -1) => {
    if (rows.length === 0) return;
    let next = active;
    for (let i = 0; i < rows.length; i++) {
      next = (next + step + rows.length) % rows.length;
      if (pickable(rows[next])) break;
    }
    setActive(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList();
      else move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      if (!open) return;
      event.preventDefault();
      choose(rows[active]);
    } else if (event.key === 'Tab') {
      if (open) close();
    }
  };

  const optionId = (index: number) => `${listId}-${index}`;
  const shownValue = open || props.multiple ? query : (selected?.label ?? '');
  const shownPlaceholder = open && selected ? selected.label : placeholder;

  return (
    <div
      ref={rootRef}
      className={cx('sf-search-select', open && 'is-open', className)}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
        if (open) close();
        onBlur?.();
      }}
    >
      <TextInput
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && rows[active] ? optionId(active) : undefined}
        disabled={disabled}
        value={shownValue}
        placeholder={shownPlaceholder}
        startAdornment={<Search aria-hidden size={16} />}
        onClick={openList}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setQuery(event.target.value);
          onQueryChange?.(event.target.value);
          openList();
        }}
      />
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label ?? placeholder}
          aria-multiselectable={props.multiple || undefined}
          className={cx('sf-search-select__panel', `sf-search-select__panel--${placement}`)}
        >
          {loading ? (
            <li className="sf-search-select__note" role="presentation">
              {t('state.loading')}
            </li>
          ) : rows.length === 0 ? (
            <li className="sf-search-select__note" role="presentation">
              {t('search.noMatches')}
            </li>
          ) : (
            rows.map((row, index) => {
              const isPicked = row.option ? picked.has(row.option.value) : picked.size === 0;
              return (
                <li
                  key={row.key}
                  id={optionId(index)}
                  data-index={index}
                  role="option"
                  aria-selected={isPicked}
                  aria-disabled={row.option?.disabled || undefined}
                  className={cx(
                    'sf-search-select__option',
                    index === active && 'is-active',
                    isPicked && 'is-picked',
                    row.option?.disabled && 'is-disabled',
                  )}
                  // Keep the focus in the box, so picking never blurs it.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => {
                    if (index !== active && pickable(row)) setActive(index);
                  }}
                  onClick={() => choose(row)}
                >
                  <span className="sf-search-select__label">{row.option ? row.option.label : clearLabel}</span>
                  {row.option?.description ? (
                    <span className="sf-search-select__description">{row.option.description}</span>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
      {props.multiple && props.value.length > 0 ? (
        <ul className="sf-search-select__picked">
          {props.value.map((value) => {
            const option = options.find((o) => o.value === value);
            const text = option?.label ?? value;
            return (
              <li key={value} className="sf-search-select__chip">
                <span>{text}</span>
                <button
                  type="button"
                  className="sf-search-select__remove"
                  aria-label={t('search.remove', { name: text })}
                  disabled={disabled}
                  onClick={() => {
                    props.onChange(props.value.filter((v) => v !== value));
                    inputRef.current?.focus();
                  }}
                >
                  <X aria-hidden size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
