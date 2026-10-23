import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, space, Text } from '../../../ui';

/**
 * A labelled value inside a card ("Customer · Sana · 0300 1234567"). The label sits above the value,
 * so long values and the largest font size never squeeze each other on a 360 dp phone.
 */
export function InfoRow({
  label,
  children,
  action,
  divider = true,
  style,
}: {
  label: string;
  /** A string is shown as body text; anything else is rendered as it is. */
  children: ReactNode;
  /** A small action under the value, e.g. "Change address". */
  action?: ReactNode;
  /** A line above the row (off for the first row of a card). */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, divider ? styles.divider : null, style]}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      {typeof children === 'string' ? <Text>{children}</Text> : children}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.xs, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  action: { alignItems: 'flex-start' },
});
