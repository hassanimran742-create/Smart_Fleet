import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { IS_DRIVER_APP } from '../api/appInfo';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, motion, radius, sizes, space, type IconTone, type TextTone } from './tokens';

/**
 * `dangerOutline` is the calm destructive trigger: a cancel inside the content (Order detail,
 * Refills), which then opens a ConfirmSheet. It mirrors `secondary` in red and never sits in the
 * footer (UX_PRINCIPLES §3, §7.1).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'ghost' | 'inverse';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Shows a spinner (and `loadingLabel`), keeps the width and ignores presses. */
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  /** What screen readers hear instead of the label, when the icon carries part of the meaning. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface VariantLook {
  background: string;
  pressed: string;
  text: TextTone;
  icon: IconTone;
  border?: string;
  spinner: string;
}

const LOOKS: Record<ButtonVariant, VariantLook> = {
  primary: { background: colors.brand, pressed: colors.brandPressed, text: 'onBrand', icon: 'onBrand', spinner: colors.onBrand },
  secondary: {
    background: colors.surface,
    pressed: colors.brandSoft,
    text: 'brand',
    icon: 'brand',
    border: colors.brand,
    spinner: colors.brandText,
  },
  danger: { background: colors.danger, pressed: colors.dangerText, text: 'onBrand', icon: 'onBrand', spinner: colors.onBrand },
  dangerOutline: {
    background: colors.surface,
    pressed: colors.dangerSoft,
    text: 'danger',
    icon: 'danger',
    border: colors.danger,
    spinner: colors.dangerText,
  },
  ghost: { background: colors.transparent, pressed: colors.brandSoft, text: 'brand', icon: 'brand', spinner: colors.brandText },
  inverse: { background: colors.surface, pressed: colors.brandSoft, text: 'brand', icon: 'brand', spinner: colors.brandText },
};

/**
 * The one button (UX_MOBILE §2.2 #5). A double-tap guard ignores presses while loading and for 600 ms
 * after a press, so a slow network never sends an action twice from a double tap.
 * Heights: md 48 and lg 56 in the shop app; 56 for every button in the driver app.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  loadingLabel,
  disabled = false,
  fullWidth = true,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const lastPress = useRef(0);
  // The width before loading, so a shorter or longer loading label never resizes the button.
  const [idleWidth, setIdleWidth] = useState<number | undefined>(undefined);
  const look = LOOKS[variant];
  const inactive = disabled || loading;
  const height = IS_DRIVER_APP || size === 'lg' ? sizes.buttonLg : sizes.buttonMd;

  const handlePress = useCallback(() => {
    if (disabled || loading) return;
    const now = Date.now();
    if (now - lastPress.current < motion.pressGuard) return;
    lastPress.current = now;
    onPress();
  }, [disabled, loading, onPress]);

  const shownLabel = loading && loadingLabel ? loadingLabel : label;
  const textTone: TextTone = disabled && !loading ? 'disabled' : look.text;

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={loading ? shownLabel : accessibilityLabel ?? shownLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      android_ripple={variant === 'ghost' ? { color: colors.ripple } : undefined}
      onLayout={(event) => {
        if (!loading) setIdleWidth(event.nativeEvent.layout.width);
      }}
      style={({ pressed }) => [
        styles.base,
        { minHeight: height },
        fullWidth ? styles.fullWidth : styles.hug,
        loading && !fullWidth && idleWidth ? { minWidth: idleWidth } : null,
        {
          backgroundColor: disabled && !loading ? colors.sunken : pressed ? look.pressed : look.background,
          borderColor: disabled && !loading ? colors.sunken : look.border ?? colors.transparent,
          borderWidth: look.border ? 1.5 : 0,
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={look.spinner} />
        ) : icon ? (
          <Icon name={icon} size={20} tone={disabled ? 'disabled' : look.icon} />
        ) : null}
        <Text variant="button" tone={textTone} align="center" numberOfLines={2} style={styles.label}>
          {shownLabel}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fullWidth: { alignSelf: 'stretch' },
  hug: { alignSelf: 'flex-start' },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  label: { flexShrink: 1 },
});
