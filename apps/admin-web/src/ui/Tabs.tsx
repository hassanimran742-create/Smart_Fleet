import { useRef, type KeyboardEvent } from 'react';
import { cx } from './cx';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  /** A count badge ("To check (3)"); hidden when null or undefined. */
  count?: number | null;
  /** The count is still loading: an empty pill keeps its place, so the tabs don't jump (UX_ADMIN §1.11). */
  countPending?: boolean;
}

export interface TabsProps<T extends string = string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the tab list for screen readers, for example "Top-up requests". */
  label: string;
  className?: string;
}

/**
 * Tabs (UX_ADMIN §1.5). The page keeps the value in `?tab=`, so a refresh or a shared link keeps the tab.
 * Arrow keys, Home and End move between tabs and select them.
 */
export function Tabs<T extends string>({ items, value, onChange, label, className }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === value);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    // Right-to-left layouts flip the arrows.
    if (document.documentElement.dir === 'rtl' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      next = event.key === 'ArrowRight' ? (index - 1 + items.length) % items.length : (index + 1) % items.length;
    }
    const target = items[next];
    if (!target) return;
    onChange(target.id);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cx('sf-tabs', className)} onKeyDown={move}>
      {items.map((item, i) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cx('sf-tab', selected && 'is-selected')}
            onClick={() => onChange(item.id)}
          >
            <span>{item.label}</span>
            {item.countPending && (item.count === undefined || item.count === null) ? (
              <span className="sf-tab__count is-pending" aria-hidden />
            ) : null}
            {item.count !== undefined && item.count !== null ? (
              <span className="sf-tab__count" aria-hidden>
                {item.count}
              </span>
            ) : null}
            {item.count !== undefined && item.count !== null ? <span className="sr-only">({item.count})</span> : null}
          </button>
        );
      })}
    </div>
  );
}
