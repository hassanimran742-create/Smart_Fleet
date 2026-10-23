import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, radius, space, Text, toneSurfaces, type IconName, type Tone } from '../../../ui';

const ICONS: Record<Tone, IconName> = {
  neutral: 'info',
  brand: 'info',
  success: 'ok',
  warning: 'warn',
  danger: 'error',
};

/**
 * An inline message in a soft tone with its icon (never colour alone): an info line, a warning
 * callout or a refusal. `alert` makes screen readers announce it when it appears.
 */
export function Notice({
  tone,
  text,
  icon,
  alert = false,
  children,
  style,
}: {
  tone: Tone;
  text: string;
  icon?: IconName;
  alert?: boolean;
  /** Buttons or extra lines under the text. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const surface = toneSurfaces[tone];
  return (
    <View
      accessibilityRole={alert ? 'alert' : undefined}
      accessibilityLiveRegion={alert ? 'polite' : undefined}
      style={[styles.box, { backgroundColor: surface.background }, style]}
    >
      <View style={styles.row}>
        <Icon name={icon ?? ICONS[tone]} size={24} tone={surface.icon} />
        <Text style={[styles.text, { color: surface.text }]}>{text}</Text>
      </View>
      {children ? <View style={styles.children}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  text: { flex: 1 },
  children: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
