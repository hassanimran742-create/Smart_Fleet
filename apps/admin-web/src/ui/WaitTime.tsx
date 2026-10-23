import { Clock, TriangleAlert } from 'lucide-react';
import type { TimeInput } from '@smartfleet/shared-utils';
import { useNow } from '../hooks/useNow';
import { formatWait } from '../i18n/format';
import { cx } from './cx';

export interface WaitTimeProps {
  /** When the wait started (ISO, epoch ms or a Date). */
  since: TimeInput;
  /** From this many minutes the wait shows as a warning, with an icon (top-ups: 60). */
  warnAfterMin?: number;
  className?: string;
}

function toIso(value: TimeInput): string | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** How long something has waited: "12 min", "1 h 20 min" (UX_ADMIN §1.5). Updates every 15 seconds. */
export function WaitTime({ since, warnAfterMin, className }: WaitTimeProps) {
  const now = useNow(15_000);
  const start = since instanceof Date ? since.getTime() : new Date(since).getTime();
  const late = warnAfterMin !== undefined && !Number.isNaN(start) && now - start >= warnAfterMin * 60_000;
  const Icon = late ? TriangleAlert : Clock;
  return (
    <time dateTime={toIso(since)} className={cx('sf-wait', late && 'is-late', className)}>
      <Icon aria-hidden size={14} strokeWidth={2.25} />
      {Number.isNaN(start) ? '—' : formatWait(start, now)}
    </time>
  );
}
