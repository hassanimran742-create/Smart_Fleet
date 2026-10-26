import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatRs, toPaisa, type PaisaLike } from '@smartfleet/shared-utils';
import { Icon } from './Icon';
import { Text } from './Text';
import { colors, radius, sizes, space } from './tokens';

/** What the "Other amount" chip reports, in place of a paisa amount. */
export const OTHER_AMOUNT = 'other';

export interface AmountChipsProps {
  /** Quick amounts in paisa, e.g. `appConfig.topup.quickAmountsPaisa`. */
  optionsPaisa: readonly PaisaLike[];
  /** The chosen amount, or `OTHER_AMOUNT` while "Other amount" is chosen. */
  selectedPaisa?: PaisaLike | null;
  /** Called with the chosen amount as a paisa digit string, or with `OTHER_AMOUNT`. */
  onSelect: (paisa: string) => void;
  /** Lays the chips out as equal cells this many across ("2" gives the 2×2 grid). */
  columns?: number;
  /** Adds a last chip with these words ("Other amount") that reports `OTHER_AMOUNT`. */
  otherLabel?: string;
  /** Read before the options. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

function asKey(value: PaisaLike | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value === OTHER_AMOUNT) return OTHER_AMOUNT;
  try {
    return String(toPaisa(value));
  } catch {
    return null;
  }
}

/** A cell's share of the row, as ChoiceChips: `columns` fit beside their gaps, one more never does. */
function cellBasis(columns: number): `${number}%` {
  return `${Math.floor(100 / (columns + 1)) + 1}%`;
}

/**
 * Quick-amount radio chips (UX_MOBILE §2.2 #10; UX_PRINCIPLES §3): 48 dp, the selected one brand with
 * a check. With `columns` the chips are equal cells and the check sits inside its cell, so nothing
 * moves when one is tapped. "Other amount" opens the screen's RupeeField; the keyboard opens only then.
 */
export function AmountChips({
  optionsPaisa,
  selectedPaisa,
  onSelect,
  columns,
  otherLabel,
  accessibilityLabel,
  style,
}: AmountChipsProps) {
  const selected = asKey(selectedPaisa);
  const cell = columns !== undefined && columns > 0 ? [styles.cell, { flexBasis: cellBasis(columns) }] : null;

  const chip = (key: string, label: string, tabular: boolean) => {
    const isSelected = key === selected;
    return (
      <Pressable
        key={key}
        onPress={() => onSelect(key)}
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ checked: isSelected }}
        android_ripple={{ color: isSelected ? colors.rippleOnBrand : colors.ripple }}
        style={[styles.chip, cell, isSelected ? styles.selected : styles.unselected]}
      >
        {isSelected ? <Icon name="check" size={20} tone="onBrand" /> : null}
        <Text
          variant="bodyStrong"
          tone={isSelected ? 'onBrand' : 'default'}
          tabular={tabular}
          align={cell ? 'center' : undefined}
          style={styles.label}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.row, style]}>
      {optionsPaisa.map((option) => {
        const key = asKey(option);
        if (key === null || key === OTHER_AMOUNT) return null;
        return chip(key, formatRs(key), true);
      })}
      {otherLabel ? chip(OTHER_AMOUNT, otherLabel, false) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: sizes.touch,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    overflow: 'hidden',
  },
  // Equal cells; at large font sizes the words wrap inside the cell rather than being cut.
  cell: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.md },
  label: { flexShrink: 1 },
  selected: { backgroundColor: colors.brand, borderWidth: 1, borderColor: colors.brand },
  unselected: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
});
