import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { Text } from './Text';
import { colors, radius, sizes, space } from './tokens';

export interface ChoiceChipOption<T extends string> {
  value: T;
  label: string;
}

export interface ChoiceChipsProps<T extends string> {
  options: readonly ChoiceChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Read before the options, e.g. "Filter history". */
  accessibilityLabel?: string;
  /** Lays the chips out this many across, as equal cells, wrapping onto more rows. */
  columns?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A grid chip's share of the row: a little more than 1 / (columns + 1), so `columns` chips fit beside
 * their gaps and one more never does. `flexGrow` then makes the chips of a row equal.
 */
function cellBasis(columns: number): `${number}%` {
  return `${Math.floor(100 / (columns + 1)) + 1}%`;
}

/**
 * One-of chips for 4–6 short options (UX_PRINCIPLES §3; moved from the shop's
 * `screens/distributor/shared/FilterChips.tsx`): 48 / 56 dp radio chips, the selected one brand with
 * a check, never colour alone. With `columns`, a grid of equal chips (the wallet filters, refill
 * sizes); without, chips of their own width. Either way they wrap onto more rows, so every chip shows
 * on a 360 dp phone at any font size and nothing scrolls sideways (§7.2).
 */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  columns,
  style,
}: ChoiceChipsProps<T>) {
  const cell = columns !== undefined && columns > 0 ? [styles.cell, { flexBasis: cellBasis(columns) }] : null;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.grid, style]}>
      {options.map((option) => {
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
            style={[styles.chip, cell, selected ? styles.selected : styles.unselected]}
          >
            {selected ? <Icon name="check" size={20} tone="onBrand" /> : null}
            <Text
              variant="label"
              tone={selected ? 'onBrand' : 'default'}
              align={cell ? 'center' : undefined}
              style={styles.cellLabel}
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: sizes.touch,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    overflow: 'hidden',
    borderWidth: 1,
    maxWidth: '100%',
  },
  // Equal chips in a grid; at large font sizes the words wrap inside the chip rather than being cut.
  cell: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.md },
  cellLabel: { flexShrink: 1 },
  selected: { backgroundColor: colors.brand, borderColor: colors.brand },
  unselected: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
});
