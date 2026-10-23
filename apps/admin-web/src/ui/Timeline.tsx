import type { ReactNode } from 'react';
import { formatDateTime } from '../i18n/format';
import { cx } from './cx';
import type { Tone } from './statusTones';

export interface TimelineItem {
  id: string;
  /** What happened, in words: "Placed · Rs 330 taken from wallet". */
  title: ReactNode;
  /** When (ISO); shown as "21 Oct, 4:12 pm". */
  at?: string | null;
  /** Who, or other detail: "by Sana". */
  meta?: ReactNode;
  tone?: Tone;
}

/** Events in order, oldest first (UX_ADMIN §1.5), for example an order's cost timeline. */
export function Timeline({ items, className }: { items: readonly TimelineItem[]; className?: string }) {
  return (
    <ol className={cx('sf-timeline', className)}>
      {items.map((item) => (
        <li key={item.id} className={cx('sf-timeline__item', `sf-tone-${item.tone ?? 'neutral'}`)}>
          <span className="sf-timeline__dot" aria-hidden />
          <div className="sf-timeline__content">
            <p className="sf-timeline__title">{item.title}</p>
            {item.at || item.meta ? (
              <p className="sf-timeline__meta">
                {item.at ? <time dateTime={item.at}>{formatDateTime(item.at)}</time> : null}
                {item.at && item.meta ? ' · ' : null}
                {item.meta}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
