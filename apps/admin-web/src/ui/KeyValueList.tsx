import type { ReactNode } from 'react';
import { cx } from './cx';

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** A stable key when labels repeat. */
  id?: string;
}

export interface KeyValueListProps {
  items: readonly KeyValueItem[];
  /** Two columns of pairs on wide drawers. */
  columns?: 1 | 2;
  /** Each label above its value, for a narrow column (the top-up drawer's "From …" side). */
  stacked?: boolean;
  /** Tighter rows, for a short breakdown ("Base · Rs 250", "11.8 kg · 2 × Rs 40"). */
  compact?: boolean;
  className?: string;
}

/** Label and value pairs, as a description list (UX_ADMIN §1.5): facts, not sentences. */
export function KeyValueList({ items, columns = 1, stacked = false, compact = false, className }: KeyValueListProps) {
  return (
    <dl
      className={cx(
        'sf-kv',
        columns === 2 && 'sf-kv--two',
        stacked && 'sf-kv--stacked',
        compact && 'sf-kv--compact',
        className,
      )}
    >
      {items.map((item, i) => (
        <div key={item.id ?? i} className="sf-kv__row">
          <dt className="sf-kv__label">{item.label}</dt>
          <dd className="sf-kv__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
