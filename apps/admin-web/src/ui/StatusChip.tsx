import type { ReactNode } from 'react';
import { Circle, CircleAlert, CircleCheck, CircleDot, Clock, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { translateDynamic } from '../i18n';
import { cx } from './cx';
import { iconOf, toneOf, type StatusKind, type StatusValue, type Tone } from './statusTones';

const TONE_ICONS: Record<Tone, LucideIcon> = {
  neutral: Circle,
  info: CircleDot,
  success: CircleCheck,
  warning: Clock,
  danger: CircleAlert,
};

const reported = new Set<string>();

function reportUnknown(kind: string, value: string): void {
  const key = `${kind}.${value}`;
  if (reported.has(key)) return;
  reported.add(key);
  // A server value the website doesn't know yet: show "Unknown", and tell engineering once.
  console.warn(`[StatusChip] no label for status:${key}`);
}

export interface ChipProps {
  tone: Tone;
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

/**
 * The 24 px pill (UX_ADMIN §1.5): an icon and words, with an AA tone. The icon is the tone's (tick,
 * clock, dot, alert, circle) unless the value has its own in `STATUS_ICONS`.
 */
export function Chip({ tone, children, icon, className }: ChipProps) {
  const Icon = icon ?? TONE_ICONS[tone];
  return (
    <span className={cx('sf-chip', `sf-chip--${tone}`, className)}>
      <Icon aria-hidden className="sf-chip__icon" size={14} strokeWidth={2.25} />
      <span className="sf-chip__label">{children}</span>
    </span>
  );
}

export interface StatusChipProps<K extends StatusKind> {
  kind: K;
  /** The API value, for example the order's `stage`. An unknown value shows "Unknown" and is logged once. */
  value: StatusValue<K> | (string & {}) | null | undefined;
  className?: string;
}

/**
 * `<StatusChip kind="order" value={order.stage} />`: the plain words from `status:<kind>.<VALUE>`, the
 * tone from `STATUS_TONES` and the icon from `STATUS_ICONS` (UX_PRINCIPLES §4).
 */
export function StatusChip<K extends StatusKind>({ kind, value, className }: StatusChipProps<K>) {
  const { t } = useTranslation();
  const label = value ? translateDynamic(`status:${kind}.${value}`) : null;
  if (value && label === null) reportUnknown(kind, value);
  const known = Boolean(label && value);
  return (
    <Chip
      tone={known ? toneOf(kind, value ?? '') : 'neutral'}
      icon={known ? iconOf(kind, value ?? '') : undefined}
      className={className}
    >
      {label ?? t('unknownStatus')}
    </Chip>
  );
}
