import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore, type ToastInput, type ToastTone } from '../store/toast';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { footerHeight, layout, motion, radius, space, toneSolids } from './tokens';
import { useReduceMotion } from './useReduceMotion';

export type { ToastInput, ToastTone };

const ICONS: Record<ToastTone, IconName | null> = {
  neutral: null,
  success: 'ok',
  warning: 'warn',
  danger: 'error',
};

/** `useToast().show({ message, tone })` (UX_MOBILE §2.2 #18). */
export function useToast(): { show: (input: ToastInput) => void; hide: () => void } {
  const show = useToastStore((s) => s.show);
  const hideCurrent = useToastStore((s) => s.hide);
  const hide = useCallback(() => hideCurrent(), [hideCurrent]);
  return useMemo(() => ({ show, hide }), [show, hide]);
}

/**
 * Hosts the toast at the app root, above any screen footer, for 3 seconds, in a live region.
 * Tapping it dismisses it.
 */
export function ToastHost() {
  const current = useToastStore((s) => s.current);
  const hide = useToastStore((s) => s.hide);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!current) return;
    opacity.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) {
      Animated.timing(opacity, { toValue: 1, duration: motion.press, useNativeDriver: true }).start();
    }
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(current.message);
    const timer = setTimeout(() => hide(current.id), current.durationMs);
    return () => clearTimeout(timer);
  }, [current, hide, opacity, reduceMotion]);

  if (!current) return null;
  const icon = ICONS[current.tone];
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={[styles.anchor, { paddingBottom: insets.bottom + footerHeight + space.sm }]}>
        <Animated.View style={{ opacity }}>
          <Pressable
            onPress={() => hide(current.id)}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel={current.message}
            style={[styles.toast, { backgroundColor: toneSolids[current.tone] }]}
          >
            {icon ? <Icon name={icon} size={20} tone="onBrand" /> : null}
            <Text tone="onBrand" style={styles.text}>
              {current.message}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: layout.gutter },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    minHeight: 48,
    elevation: 6,
  },
  text: { flex: 1 },
});
