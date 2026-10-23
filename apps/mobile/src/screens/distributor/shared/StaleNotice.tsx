import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatPkTime, localDate } from '@smartfleet/shared-utils';
import { formatWhenText } from '../../../i18n';
import { Icon, radius, sizes, space, Text, toneSurfaces, useNoConnection } from '../../../ui';

/** "4:12 pm" today, otherwise "Yesterday, 9:05 am" / "Mon 19 Oct, 4:12 pm" (Asia/Karachi). */
export function savedAtText(updatedAt: number, now: number = Date.now()): string {
  return localDate(updatedAt) === localDate(now) ? formatPkTime(updatedAt) : formatWhenText(updatedAt, now);
}

/**
 * "Saved 4:12 pm" over saved data whose refresh failed (shop spec §3.1), for list screens that hold
 * their own FlatList (QueryBoundary draws the same strip for the others). The `history` icon, never
 * the clock: the clock means waiting. While the "No connection" banner shows, the banner's Try again
 * is the only one; otherwise tapping the strip tries again.
 */
export function StaleNotice({ updatedAt, onRetry }: { updatedAt: number; onRetry: () => void }) {
  const { t } = useTranslation();
  const bannerShowing = useNoConnection();
  const surface = toneSurfaces.warning;
  const text = t('common.stale', { time: savedAtText(updatedAt) });
  const words = (
    <>
      <Icon name="history" size={20} tone={surface.icon} />
      <Text variant="caption" style={[styles.text, { color: surface.text }]}>
        {text}
      </Text>
    </>
  );
  if (bannerShowing) {
    return (
      <View accessible accessibilityLabel={text} style={[styles.strip, { backgroundColor: surface.background }]}>
        {words}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={t('common.actions.tryAgain')}
      style={[styles.strip, { backgroundColor: surface.background }]}
    >
      {words}
      <Text variant="label" tone="brand">
        {t('common.actions.tryAgain')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: sizes.touch,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  text: { flex: 1 },
});
