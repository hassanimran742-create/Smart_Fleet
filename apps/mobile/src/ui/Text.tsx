import type { ReactNode } from 'react';
import {
  Text as RNText,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import { fontScale, tabularNums, textTones, typography, type TextTone, type TextVariant } from './tokens';

export type { TextTone, TextVariant };

export interface TextProps extends Omit<RNTextProps, 'style' | 'children'> {
  children?: ReactNode;
  variant?: TextVariant;
  tone?: TextTone;
  align?: 'auto' | 'left' | 'center' | 'right';
  /** Tabular numbers, for money and counters. */
  tabular?: boolean;
  style?: StyleProp<TextStyle>;
}

/**
 * All text (UX_MOBILE §2.2 #1). Sets the font-scale cap (1.3, 1.2 for display) and makes title and
 * heading screen-reader headers.
 */
export function Text({
  children,
  variant = 'body',
  tone = 'default',
  align,
  tabular = false,
  style,
  maxFontSizeMultiplier,
  accessibilityRole,
  ...rest
}: TextProps) {
  const isHeader = variant === 'title' || variant === 'heading';
  return (
    <RNText
      {...rest}
      accessibilityRole={accessibilityRole ?? (isHeader ? 'header' : undefined)}
      maxFontSizeMultiplier={
        maxFontSizeMultiplier ?? (variant === 'display' ? fontScale.maxDisplay : fontScale.max)
      }
      style={[
        typography[variant],
        { color: textTones[tone] },
        align ? { textAlign: align } : null,
        tabular ? tabularNums : null,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
