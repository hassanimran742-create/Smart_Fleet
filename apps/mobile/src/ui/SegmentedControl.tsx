import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, radius, sizes, space } from './tokens';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Read before the options, e.g. "Paid with". */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Two to four mutually exclusive options (UX_MOBILE §2.2 #11): 48 / 56 dp, a radio group. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: SegmentedControlProps<T>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.group, style]}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            android_ripple={{ color: selected ? colors.rippleOnBrand : colors.ripple }}
            style={[
              styles.segment,
              index > 0 ? styles.divider : null,
              selected ? styles.selected : null,
            ]}
          >
            {option.icon ? (
              <Icon name={option.icon} size={20} tone={selected ? 'onBrand' : 'brand'} />
            ) : null}
            <Text
              variant="label"
              tone={selected ? 'onBrand' : 'brand'}
              align="center"
              numberOfLines={2}
              style={styles.label}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minHeight: sizes.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  divider: { borderStartWidth: 1, borderStartColor: colors.brand },
  selected: { backgroundColor: colors.brand },
  label: { flexShrink: 1 },
});
