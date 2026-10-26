import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, elevation, layout, radius, type Tone } from './tokens';

export type CardTone = 'default' | Exclude<Tone, 'neutral'>;

export interface CardProps {
  children?: ReactNode;
  /** `brand` is the solid wallet-card colour (use onBrand text on it); the others are soft tints. */
  tone?: CardTone;
  onPress?: () => void;
  /** Inner padding in dp; 16 by default. */
  padding?: number;
  /** `lg` (16) for hero cards such as the wallet card; `md` (12) otherwise. */
  rounded?: 'md' | 'lg';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TONES: Record<CardTone, ViewStyle> = {
  default: { backgroundColor: colors.surface, ...elevation.card },
  brand: { backgroundColor: colors.brandText },
  success: { backgroundColor: colors.successSoft },
  warning: { backgroundColor: colors.warningSoft },
  danger: { backgroundColor: colors.dangerSoft },
};

/** A surface for grouped content (UX_MOBILE §2.2 #6). A pressable card ripples and reads as a button. */
export function Card({
  children,
  tone = 'default',
  onPress,
  padding = layout.cardPadding,
  rounded = 'md',
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: CardProps) {
  const frame: StyleProp<ViewStyle> = [
    styles.base,
    TONES[tone],
    { padding, borderRadius: rounded === 'lg' ? radius.lg : radius.md },
    style,
  ];
  if (!onPress) {
    return (
      <View testID={testID} style={frame} accessibilityLabel={accessibilityLabel}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      android_ripple={{ color: tone === 'brand' ? colors.rippleOnBrand : colors.ripple }}
      style={frame}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
});
