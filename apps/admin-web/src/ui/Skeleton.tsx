import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';

export interface SkeletonProps {
  /** CSS width; 100% by default. */
  width?: CSSProperties['inlineSize'];
  /** CSS height; one line of text by default. */
  height?: CSSProperties['blockSize'];
  radius?: 'sm' | 'md' | 'pill';
  className?: string;
}

/** A grey placeholder in the final layout's shape (UX_ADMIN §1.9). Hidden from screen readers. */
export function Skeleton({ width = '100%', height = '1em', radius = 'sm', className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cx('sf-skeleton', `sf-skeleton--${radius}`, className)}
      style={{ inlineSize: width, blockSize: height }}
    />
  );
}

/** A few lines of placeholder text, with one "Loading…" for screen readers. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cx('sf-skeleton-text', className)}>
      <span className="sr-only" role="status">
        {t('state.loading')}
      </span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}
