import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { colors, layout, motion, radius, space } from './tokens';
import { useReduceMotion } from './useReduceMotion';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  /** A slow pulse; never under reduce-motion. Off by default (static blocks are cheapest). */
  pulse?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A placeholder block shown while data loads (UX_MOBILE §2.2 #17). Never shows "Rs 0". */
export function Skeleton({ width = '100%', height = 16, rounded = radius.sm, pulse = false, style }: SkeletonProps) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const animate = pulse && !reduceMotion;

  useEffect(() => {
    if (!animate) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: motion.pulse / 2, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: motion.pulse / 2, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: rounded, backgroundColor: colors.sunken, opacity }, style]}
    />
  );
}

/** A few text-line placeholders; the last line is shorter. */
export function SkeletonLines({ lines = 3, pulse }: { lines?: number; pulse?: boolean }) {
  return (
    <View style={styles.lines}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? '60%' : '100%'} pulse={pulse} />
      ))}
    </View>
  );
}

/** A card-shaped placeholder: a heading bar and a few lines. */
export function SkeletonCard({ lines = 2, pulse }: { lines?: number; pulse?: boolean }) {
  return (
    <View style={styles.card}>
      <Skeleton width="50%" height={20} pulse={pulse} />
      <SkeletonLines lines={lines} pulse={pulse} />
    </View>
  );
}

/** List placeholders, one per expected row. */
export function SkeletonList({ rows = 4, pulse }: { rows?: number; pulse?: boolean }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonCard key={i} lines={1} pulse={pulse} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  lines: { gap: space.sm },
  card: {
    gap: space.md,
    padding: layout.cardPadding,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  list: { gap: layout.cardGap },
});
