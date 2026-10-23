import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatRs, type PaisaLike } from '@smartfleet/shared-utils';
import { Icon, type IconName } from './Icon';
import { resolveStatus, type StatusKind, type StatusParams } from './statusTables';
import { Text } from './Text';
import { radius, sizes, space, toneSurfaces, type Tone } from './tokens';

export type ChipTone = Tone;

interface ByStatus {
  kind: StatusKind;
  /** The server's stable value, e.g. an `OrderStage`. Unknown values show "Updating…". */
  value: string | null | undefined;
  /** The fee chip's amount ("Rs 330 paid"). */
  amountPaisa?: PaisaLike | null;
  /** The step's own icon on an IN_PROGRESS step chip (Load `van`, Deliver `customer`, Unload `store`). */
  stepIcon?: IconName;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface Direct {
  tone: ChipTone;
  label: string;
  icon?: IconName | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export type StatusChipProps = ByStatus | Direct;

const warned = new Set<string>();

function feeParam(amountPaisa: PaisaLike | null | undefined): StatusParams {
  if (amountPaisa === null || amountPaisa === undefined) return {};
  try {
    return { fee: formatRs(amountPaisa) };
  } catch {
    return {};
  }
}

/**
 * A status chip (UX_MOBILE §2.2 #8): 28 dp, a 14 semibold label and a 16 icon, never colour alone.
 * Either looks the words up from the §3.4 tables (`kind` + `value`) or takes `tone` + `label`.
 */
export function StatusChip(props: StatusChipProps) {
  const { t } = useTranslation();
  let tone: ChipTone;
  let label: string;
  let icon: IconName | null | undefined;

  if ('kind' in props) {
    const resolved = resolveStatus(props.kind, props.value, t, { ...feeParam(props.amountPaisa), icon: props.stepIcon });
    if (resolved) {
      ({ tone, label, icon } = resolved);
    } else {
      const key = `${props.kind}:${String(props.value)}`;
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`StatusChip: unknown ${props.kind} value "${String(props.value)}"`);
      }
      tone = 'neutral';
      label = t('stages.unknown');
      icon = null;
    }
  } else {
    ({ tone, label, icon } = props);
  }

  const surface = toneSurfaces[tone];
  return (
    <View
      testID={props.testID}
      accessible
      accessibilityLabel={label}
      style={[styles.chip, { backgroundColor: surface.background }, props.style]}
    >
      {icon ? <Icon name={icon} size={16} tone={surface.icon} /> : null}
      <Text variant="label" numberOfLines={2} style={[styles.label, { color: surface.text }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: sizes.chip,
    paddingVertical: space.xs / 2,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.pill,
    maxWidth: '100%',
  },
  // Chips are always 14 / semibold, in both apps.
  label: { fontSize: 14, lineHeight: 18, flexShrink: 1 },
});
