import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ltr } from './bidi';
import { Card } from './Card';
import { Icon } from './Icon';
import { Text } from './Text';
import { colors, space } from './tokens';

/**
 * - `target`: "2 of 3" and the verb, with a bar. Complete at the total ("All 3 loaded"); past it
 *   (Inc 1's tally only) a warning "4 scanned · 3 needed".
 * - `soft`: a count against what is expected ("0" · "taken back · 2 expected"), never red and never
 *   blocking; success once the expected number is reached.
 * - `countdown`: what is left ("3" · "on the van"); success at 0 with `completeLabel`.
 */
export type CountBarMode = 'target' | 'soft' | 'countdown';

export interface CountBarProps {
  mode?: CountBarMode;
  /** Done so far (target, soft) or left (countdown). */
  count: number;
  /** target: the number needed; soft: the number expected (0 or null: nothing expected). */
  total?: number | null;
  /** The word after the number, already translated: "scanned", "loaded", "taken back", "on the van". */
  verb: string;
  /** The words once complete. Default "All {{total}} {{verb}}"; countdown passes its own ("Nothing on the van."). */
  completeLabel?: string;
  /** A line under the count, e.g. "2 full · 1 empty". */
  detail?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The big count of a scan step (UX_PRINCIPLES §3, §9.2; driver spec §1.4, the one definition for both
 * apps): the number in `display`, the verb beside it, and an 8 dp bar. Complete turns the card green
 * with a tick. Screen readers hear one polite update ("2 of 3 loaded"). At the largest font the verb
 * wraps under the number; the number never shrinks. Per-size progress is not in here (SizeLines).
 */
export function CountBar({ mode = 'target', count, total, verb, completeLabel, detail, style, testID }: CountBarProps) {
  const { t } = useTranslation();
  const done = Math.max(0, Math.floor(count));
  const needed = total !== null && total !== undefined && total > 0 ? Math.floor(total) : 0;
  const n = (value: number) => ltr(String(value));

  const complete =
    mode === 'countdown' ? done === 0 : mode === 'soft' ? needed > 0 && done >= needed : needed > 0 && done === needed;
  const over = mode === 'target' && needed > 0 && done > needed;

  if (complete && mode !== 'soft') {
    const words =
      completeLabel ??
      (mode === 'countdown'
        ? t('common.count.alone', { done: n(done), verb })
        : t('common.count.complete', { total: n(needed), verb }));
    return (
      <Card tone="success" testID={testID} style={style}>
        <View style={styles.completeRow} accessible accessibilityLabel={words} accessibilityLiveRegion="polite">
          <Icon name="ok" size={32} tone="success" />
          <Text variant="title" tone="success" style={styles.flexText}>
            {words}
          </Text>
        </View>
        {detail ? <Detail text={detail} /> : null}
        {mode === 'target' ? <Bar fill={1} color={colors.successGraphic} /> : null}
      </Card>
    );
  }

  if (over) {
    const words = t('common.count.over', { done: n(done), total: n(needed), verb });
    return (
      <Card testID={testID} style={style}>
        <View accessible accessibilityLabel={words} accessibilityLiveRegion="polite">
          <Text variant="title" tone="warning">
            {words}
          </Text>
        </View>
        {detail ? <Detail text={detail} /> : null}
        <Bar fill={1} color={colors.warningGraphic} />
      </Card>
    );
  }

  let big: string;
  let label: string;
  let spoken: string;
  if (mode === 'target' && needed > 0) {
    big = t('common.count.progress', { done: n(done), total: n(needed) });
    label = verb;
    spoken = t('common.count.progressA11y', { done: n(done), total: n(needed), verb });
  } else if (mode === 'soft' && needed > 0) {
    big = n(done);
    label = t('common.count.expected', { total: n(needed), verb });
    spoken = t('common.count.expectedA11y', { done: n(done), total: n(needed), verb });
  } else {
    big = n(done);
    label = verb;
    spoken = t('common.count.alone', { done: n(done), verb });
  }

  // Only `soft` reaches here complete: the same count, turned green.
  const tone = complete ? 'success' : 'default';
  return (
    <Card tone={complete ? 'success' : 'default'} testID={testID} style={style}>
      <View style={styles.countRow} accessible accessibilityLabel={spoken} accessibilityLiveRegion="polite">
        {complete ? <Icon name="ok" size={32} tone="success" /> : null}
        <Text variant="display" tone={tone} tabular numberOfLines={1}>
          {big}
        </Text>
        <Text variant="heading" tone={tone} style={styles.verb}>
          {label}
        </Text>
      </View>
      {detail ? <Detail text={detail} /> : null}
      {mode === 'target' && needed > 0 ? <Bar fill={done / needed} color={colors.brand} /> : null}
    </Card>
  );
}

function Detail({ text }: { text: string }) {
  return (
    <Text variant="bodyStrong" style={styles.detail}>
      {text}
    </Text>
  );
}

/** The 8 dp progress bar: a `sunken` track and a coloured fill. Decorative: the words say the count. */
function Bar({ fill, color }: { fill: number; color: string }) {
  const share = Math.max(0, Math.min(1, fill));
  return (
    <View style={styles.track} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.fill, { width: `${share * 100}%` as const, backgroundColor: color }]} />
    </View>
  );
}

const BAR_HEIGHT = 8;

const styles = StyleSheet.create({
  countRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.sm },
  completeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flexText: { flex: 1 },
  // The verb wraps under the number at the largest font; the number keeps its size.
  verb: { flexShrink: 1 },
  detail: { marginTop: space.xs },
  track: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: colors.sunken,
    overflow: 'hidden',
    marginTop: space.md,
  },
  fill: { height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2 },
});
