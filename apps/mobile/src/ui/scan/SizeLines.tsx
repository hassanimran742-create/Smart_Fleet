import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { space } from '../tokens';

/** One size line, its words already translated. */
export interface SizeLine {
  key: string;
  /** "2 × 11.8 kg" (what to load or give); from Inc 2 also "11.8 kg · 1 of 2" (per-size progress). */
  text: string;
  /** That size is complete: an `ok` tick in place of the cylinder. */
  complete?: boolean;
  /** A quieter line under the sizes, e.g. "Take back 2". */
  secondary?: boolean;
}

export interface SizeLinesProps {
  lines: readonly SizeLine[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The sizes of a scan step (driver spec §5; shared with the shop's Receive scan in Inc 2): one line per
 * size with the cylinder icon, under the scan strip. Per-size progress lives here, never in the
 * CountBar. Nothing renders without lines.
 */
export function SizeLines({ lines, style, testID }: SizeLinesProps) {
  if (lines.length === 0) return null;
  return (
    <View style={[styles.list, style]} testID={testID}>
      {lines.map((line) => (
        <View key={line.key} style={styles.line}>
          <Icon
            name={line.complete ? 'ok' : 'cylinder'}
            size={24}
            tone={line.complete ? 'success' : line.secondary ? 'secondary' : 'brand'}
          />
          <Text
            variant={line.secondary ? 'body' : 'bodyStrong'}
            tone={line.secondary ? 'secondary' : 'default'}
            tabular
            style={styles.text}
          >
            {line.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  text: { flex: 1 },
});
