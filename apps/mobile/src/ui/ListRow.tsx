import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, layout, sizes, space } from './tokens';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** A third, quieter line, e.g. the time. */
  meta?: string;
  leadingIcon?: IconName;
  /** Right-hand content: a StatusChip, a MoneyText… */
  trailing?: ReactNode;
  /**
   * Content under the text lines, such as a StatusChip. Unlike `trailing` it takes no width from the
   * title, so a long name keeps the row's full width (the driver's trip and stop rows).
   */
  below?: ReactNode;
  onPress?: () => void;
  /** Shows a chevron (it flips in right-to-left layouts). */
  chevron?: boolean;
  /** Replaces the spoken label built from title, subtitle and meta. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /**
   * Screen-reader actions for a button inside a pressable row ("Call Sana" on Customers): the row is one
   * element to TalkBack, so a nested button is reached through the row's actions.
   */
  accessibilityActions?: ReadonlyArray<AccessibilityActionInfo>;
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A list row (UX_MOBILE §2.2 #13): at least 64 / 72 dp; the title wraps to two lines at most. */
export function ListRow({
  title,
  subtitle,
  meta,
  leadingIcon,
  trailing,
  below,
  onPress,
  chevron = false,
  accessibilityLabel,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
  style,
  testID,
}: ListRowProps) {
  const spoken = accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(', ');
  const body = (
    <>
      {leadingIcon ? (
        <View style={styles.leading}>
          <Icon name={leadingIcon} size={24} tone="secondary" />
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {below ? <View style={styles.below}>{below}</View> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {chevron ? <Icon name="chevron" size={24} tone="secondary" /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, style]} accessible accessibilityLabel={spoken}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={accessibilityHint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null, style]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: sizes.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.canvas },
  leading: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, gap: 2 },
  below: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  trailing: { alignItems: 'flex-end', maxWidth: '45%' },
});
