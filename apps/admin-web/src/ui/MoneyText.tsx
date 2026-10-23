import { useMemo } from 'react';
import type { PaisaLike } from '@smartfleet/shared-utils';
import { formatRs } from '../i18n/format';
import { cx } from './cx';

export interface MoneyTextProps {
  /** Integer paisa: a digit string from the API, a number or a BigInt. null shows "—". */
  paisa: PaisaLike | null | undefined;
  /** Mark money in with "+" as well as money out with "−" (statement rows). */
  signed?: boolean;
  /** `auto` colours the sign (green in, red out); `none` keeps the text colour. */
  tone?: 'auto' | 'none';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  strong?: boolean;
  className?: string;
}

function signOf(paisa: PaisaLike): -1 | 0 | 1 {
  if (typeof paisa === 'bigint') return paisa < 0n ? -1 : paisa > 0n ? 1 : 0;
  if (typeof paisa === 'number') return paisa < 0 ? -1 : paisa > 0 ? 1 : 0;
  const text = paisa.trim();
  if (/^-0*$/.test(text) || /^0+$/.test(text)) return 0;
  return text.startsWith('-') ? -1 : 1;
}

/** Money as "Rs 3,450" (UX_ADMIN §1.5), with tabular figures so columns line up. */
export function MoneyText({ paisa, signed = false, tone = 'none', size = 'md', strong = false, className }: MoneyTextProps) {
  const { text, sign } = useMemo(() => {
    if (paisa === null || paisa === undefined) return { text: formatRs(null), sign: 0 as const };
    try {
      return { text: formatRs(paisa, { sign: signed ? 'always' : 'auto' }), sign: signOf(paisa) };
    } catch {
      return { text: formatRs(null), sign: 0 as const };
    }
  }, [paisa, signed]);
  const toneClass = tone === 'auto' && sign !== 0 ? (sign > 0 ? 'is-in' : 'is-out') : null;
  return <span className={cx('sf-money', `sf-money--${size}`, strong && 'is-strong', toneClass, className)}>{text}</span>;
}
