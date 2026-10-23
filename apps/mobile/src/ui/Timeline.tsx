import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { Text } from './Text';
import { colors, space } from './tokens';

/**
 * `stopped` ends a cancelled order: the neutral cross, never a green tick (UX_PRINCIPLES §4.1).
 * `problem` is the red mark of "Not delivered".
 */
export type TimelineState = 'done' | 'current' | 'todo' | 'problem' | 'stopped';

export interface TimelineItem {
  key: string;
  label: string;
  /** Already formatted, e.g. with `formatWhenText`. */
  time?: string;
  detail?: string;
  state: TimelineState;
}

export interface TimelineProps {
  items: readonly TimelineItem[];
  style?: StyleProp<ViewStyle>;
}

const DOT = 24;

/** A vertical list of steps with their times (UX_MOBILE §2.2 #21). */
export function Timeline({ items, style }: TimelineProps) {
  const { t } = useTranslation();
  const stateWord: Record<TimelineState, string> = {
    done: t('common.timeline.done'),
    current: t('common.timeline.current'),
    todo: t('common.timeline.todo'),
    problem: t('common.timeline.problem'),
    stopped: t('common.timeline.stopped'),
  };
  return (
    <View style={style}>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const spoken = [item.label, stateWord[item.state], item.time, item.detail].filter(Boolean).join(', ');
        return (
          <View key={item.key} style={styles.item} accessible accessibilityLabel={spoken}>
            <View style={styles.rail}>
              <Marker state={item.state} />
              {!last ? (
                <View
                  style={[styles.line, { backgroundColor: item.state === 'done' ? colors.successGraphic : colors.border }]}
                />
              ) : null}
            </View>
            <View style={[styles.texts, !last ? styles.textsGap : null]}>
              <Text
                variant={item.state === 'current' ? 'bodyStrong' : 'body'}
                tone={item.state === 'todo' ? 'secondary' : item.state === 'problem' ? 'danger' : 'default'}
              >
                {item.label}
              </Text>
              {item.time ? (
                <Text variant="caption" tone="secondary">
                  {item.time}
                </Text>
              ) : null}
              {item.detail ? (
                <Text variant="caption" tone="secondary">
                  {item.detail}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Marker({ state }: { state: TimelineState }) {
  if (state === 'done') return <Icon name="ok" size={24} tone="successGraphic" />;
  if (state === 'problem') return <Icon name="error" size={24} tone="danger" />;
  if (state === 'stopped') return <Icon name="close" size={24} tone="neutral" />;
  if (state === 'current') {
    return (
      <View style={[styles.ring, styles.ringCurrent]}>
        <View style={styles.innerDot} />
      </View>
    );
  }
  return <View style={[styles.ring, styles.ringTodo]} />;
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', gap: space.md },
  rail: { width: DOT, alignItems: 'center' },
  line: { width: 2, flex: 1, minHeight: space.lg, marginVertical: 2, borderRadius: 1 },
  texts: { flex: 1, paddingTop: 1 },
  textsGap: { paddingBottom: space.lg },
  ring: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  ringCurrent: { borderWidth: 2, borderColor: colors.brand },
  ringTodo: { borderWidth: 2, borderColor: colors.borderStrong },
  innerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
});
