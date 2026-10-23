import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, elevation, motion, radius, sizes, space } from './tokens';

export interface FabProps {
  /** Always shown beside the icon: "New order", "Add customer", "New refill". */
  label: string;
  onPress: () => void;
  /** `plus` by default. */
  icon?: IconName;
  /** False hides it (Refills while the list is empty: the empty state carries the button). */
  visible?: boolean;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * Bottom room a list needs so its last row clears the Fab (56 dp plus 16 dp above and below). A
 * scrolling `Screen` with a `fab` adds it; a FlatList adds it to its `contentContainerStyle`.
 */
export const FAB_CLEARANCE = sizes.buttonLg + space.lg * 2;

/**
 * "New" on a list screen (UX_PRINCIPLES §3, §7.3): an extended floating button with the primary
 * Button's look (brand, radius md, 56 dp, the button type) and the sheet elevation. It sits at the
 * bottom end, 16 dp in, above the safe area, and hides while the keyboard is open. Its label always
 * shows. Pass it to `Screen`'s `fab`; a list screen has a Fab or a footer, never both.
 */
export function Fab({ label, onPress, icon = 'plus', visible = true, accessibilityHint, testID }: FabProps) {
  const keyboardOpen = useKeyboardOpen();
  const lastPress = useRef(0);

  if (!visible || keyboardOpen) return null;
  return (
    <View pointerEvents="box-none" style={styles.anchor}>
      <Pressable
        testID={testID}
        onPress={() => {
          // The Button's double-tap guard: one tap opens one screen.
          const now = Date.now();
          if (now - lastPress.current < motion.pressGuard) return;
          lastPress.current = now;
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        android_ripple={{ color: colors.rippleOnBrand }}
        style={({ pressed }) => [styles.fab, elevation.sheet, pressed ? styles.pressed : null]}
      >
        <Icon name={icon} size={24} tone="onBrand" />
        <Text variant="button" tone="onBrand" numberOfLines={1} style={styles.label}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return open;
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', bottom: space.lg, end: space.lg, start: space.lg, alignItems: 'flex-end' },
  fab: {
    minHeight: sizes.buttonLg,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingStart: space.lg,
    paddingEnd: space.xl,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: colors.brandPressed },
  label: { flexShrink: 1 },
});
