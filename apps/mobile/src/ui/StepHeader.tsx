import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { colors, space } from './tokens';

export interface StepHeaderProps {
  step: number;
  total: number;
  title: string;
  style?: StyleProp<ViewStyle>;
}

/** "Step 2 of 3" with a segmented bar and the step's title (UX_MOBILE §2.2 #20). */
export function StepHeader({ step, total, title, style }: StepHeaderProps) {
  const { t } = useTranslation();
  const progress = t('common.step', { step, total });
  return (
    <View style={[styles.wrap, style]}>
      <Text variant="label" tone="secondary">
        {progress}
      </Text>
      <View
        style={styles.bar}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={progress}
        accessibilityValue={{ min: 0, max: total, now: step }}
      >
        {Array.from({ length: Math.max(total, 1) }, (_, i) => (
          <View key={i} style={[styles.segment, { backgroundColor: i < step ? colors.brand : colors.sunken }]} />
        ))}
      </View>
      <Text variant="title">{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, marginBottom: space.lg },
  bar: { flexDirection: 'row', gap: space.xs },
  segment: { flex: 1, height: 4, borderRadius: 2 },
});
