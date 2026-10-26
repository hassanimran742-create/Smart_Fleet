import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { Text } from './Text';
import { colors, radius, sizes, space } from './tokens';

export interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  /** A line under the label, e.g. "Take back 2". */
  helper?: string;
  step?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A whole-number picker (UX_MOBILE §2.2 #12): 48 / 56 dp − and + buttons. Screen readers get one
 * adjustable control (swipe up or down) instead of two buttons.
 */
export function Stepper({ value, min, max, onChange, label, helper, step = 1, disabled = false, style, testID }: StepperProps) {
  const { t } = useTranslation();
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;
  const change = (delta: number) => {
    const next = clamp(value + delta, min, max);
    if (next !== value) onChange(next);
  };

  return (
    <View
      testID={testID}
      style={[styles.row, style]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint={helper}
      accessibilityValue={{ min, max, now: value }}
      accessibilityState={{ disabled }}
      accessibilityActions={[
        { name: 'increment', label: t('common.stepper.increase') },
        { name: 'decrement', label: t('common.stepper.decrease') },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') change(step);
        if (event.nativeEvent.actionName === 'decrement') change(-step);
      }}
    >
      <View style={styles.text}>
        <Text variant="bodyStrong">{label}</Text>
        {helper ? (
          <Text variant="caption" tone="secondary">
            {helper}
          </Text>
        ) : null}
      </View>
      <View style={styles.controls}>
        <StepButton icon="minus" enabled={canDecrease} onPress={() => change(-step)} />
        <Text variant="heading" tabular align="center" style={styles.value}>
          {String(value)}
        </Text>
        <StepButton icon="plus" enabled={canIncrease} onPress={() => change(step)} />
      </View>
    </View>
  );
}

function StepButton({ icon, enabled, onPress }: { icon: 'minus' | 'plus'; enabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      android_ripple={{ color: colors.ripple, borderless: false }}
      style={[styles.button, enabled ? styles.buttonEnabled : styles.buttonDisabled]}
    >
      <Icon name={icon} size={24} tone={enabled ? 'brand' : 'disabled'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: sizes.touch,
  },
  text: { flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  value: { minWidth: 40 },
  button: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  buttonEnabled: { borderWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.surface },
  buttonDisabled: { backgroundColor: colors.sunken },
});
