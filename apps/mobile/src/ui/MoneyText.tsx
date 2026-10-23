import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { StyleProp, TextStyle } from 'react-native';
import { formatRs, MINUS_SIGN, MISSING_AMOUNT, type PaisaLike } from '@smartfleet/shared-utils';
import { ltr } from './bidi';
import { Text, type TextTone, type TextVariant } from './Text';

export type MoneySign = 'none' | 'auto' | 'always';

export interface MoneyTextProps {
  /** Integer paisa: the wire's digit string, a number or a BigInt. Null shows "—". */
  paisa: PaisaLike | null | undefined;
  variant?: TextVariant;
  tone?: TextTone;
  /** `auto` marks money out ("−Rs 330"); `always` also marks money in ("+Rs 5,000"). */
  sign?: MoneySign;
  align?: 'auto' | 'left' | 'center' | 'right';
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/** Formats paisa safely: a malformed value shows "—" instead of crashing the screen. */
function safeFormat(paisa: PaisaLike | null | undefined, sign: MoneySign): { text: string; ok: boolean } {
  try {
    return { text: formatRs(paisa, { sign }), ok: paisa !== null && paisa !== undefined };
  } catch (error) {
    console.warn('MoneyText: not a paisa amount', paisa, error);
    return { text: MISSING_AMOUNT, ok: false };
  }
}

/**
 * Every amount on screen (UX_MOBILE §2.2 #7, §3.7): `formatRs` only, tabular numbers, and a spoken
 * label from `money.a11y` ("3,450 rupees"). Only `formatRs` divides by 100.
 */
export function MoneyText({
  paisa,
  variant = 'body',
  tone = 'default',
  sign = 'auto',
  align,
  numberOfLines,
  style,
  testID,
}: MoneyTextProps) {
  const { t } = useTranslation();
  const { text, ok } = safeFormat(paisa, sign);
  return (
    <Text
      testID={testID}
      variant={variant}
      tone={tone}
      align={align}
      tabular
      numberOfLines={numberOfLines}
      style={style}
      accessibilityLabel={ok ? moneyA11yLabel(text, t) : t('money.missing')}
    >
      {ltr(text)}
    </Text>
  );
}

/**
 * The plain i18next `TFunction`. `ReturnType<typeof useTranslation>['t']` fixes the key prefix at its
 * constraint (every key path), which costs millions of type instantiations per call (TS2589).
 */
type Translate = TFunction;

/** "Rs 3,450" → "3,450 rupees"; "−Rs 330" → "minus 330 rupees"; "+Rs 5,000" → "plus 5,000 rupees". */
export function moneyA11yLabel(formatted: string, t: Translate): string {
  const negative = formatted.startsWith(MINUS_SIGN);
  const positive = formatted.startsWith('+');
  const unsigned = negative || positive ? formatted.slice(1) : formatted;
  const amount = unsigned.replace(/^Rs\s*/, '');
  if (negative) return t('money.a11yNegative', { amount });
  if (positive) return t('money.a11yPositive', { amount });
  return t('money.a11y', { amount });
}
