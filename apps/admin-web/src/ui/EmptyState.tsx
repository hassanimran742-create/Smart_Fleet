import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import { cx } from './cx';

export interface EmptyStateProps {
  /** Says what will appear here and when (UX_ADMIN §1.9); never developer text. */
  title: ReactNode;
  body?: ReactNode;
  icon?: LucideIcon;
  /** At most one button, for example "Add expense". */
  action?: ReactNode;
  /** Smaller padding, inside a card or a table. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ title, body, icon: Icon = Inbox, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cx('sf-empty', compact && 'sf-empty--compact', className)}>
      <Icon aria-hidden className="sf-empty__icon" size={compact ? 24 : 32} strokeWidth={1.75} />
      <p className="sf-empty__title">{title}</p>
      {body ? <p className="sf-empty__body">{body}</p> : null}
      {action ? <div className="sf-empty__action">{action}</div> : null}
    </div>
  );
}
