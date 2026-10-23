import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { formatPkTime, localDate } from '@smartfleet/shared-utils';
import { formatWhenText } from '../../../i18n';
import { Icon, radius, sizes, space, Text, toneSurfaces } from '../../../ui';

/** "4:12 pm" today, otherwise "Yesterday, 9:05 am" / "Mon 19 Oct, 4:12 pm" (Asia/Karachi). */
export function savedAtText(updatedAt: number, now: number = Date.now()): string {
  return localDate(updatedAt) === localDate(now) ? formatPkTime(updatedAt) : formatWhenText(updatedAt, now);
}

/**
 * "Showing saved info from 4:12 pm. Couldn't refresh." (UX_MOBILE §2.2 QueryBoundary), for list
 * screens that hold their own FlatList: shown above the saved data when a refresh failed. Tapping it
 * tries again.
 */
export function StaleNotice({ updatedAt, onRetry }: { updatedAt: number; onRetry: () => void }) {
  const { t } = useTranslation();
  const surface = toneSurfaces.warning;
  const text = t('common.stale', { time: savedAtText(updatedAt) });
  return (
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={t('common.actions.tryAgain')}
      style={[styles.strip, { backgroundColor: surface.background }]}
    >
      <Icon name="checking" size={20} tone={surface.icon} />
      <Text variant="caption" style={[styles.text, { color: surface.text }]}>
        {text}
      </Text>
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
    marginBottom: space.md,
  },
  text: { flex: 1 },
});
