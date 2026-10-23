import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatPkTime, localDate } from '@smartfleet/shared-utils';
import { formatWhenText } from '../i18n';
// Only these modules: the REV mobile-ux-06 test compiles this file with exactly them stubbed. The
// connection state and the offline block come through ErrorBanner for that reason.
import { ErrorBanner, isNoAnswer, OfflineEmpty, useNoConnection, type ErrorBannerAction } from './ErrorBanner';
import { Icon } from './Icon';
import { SkeletonList } from './Skeleton';
import { Text } from './Text';
import { radius, sizes, space, toneSurfaces } from './tokens';

/** The parts of a React Query result the boundary reads. */
export interface BoundaryQuery<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => unknown;
}

export interface QueryBoundaryProps<T> {
  query: BoundaryQuery<T>;
  /** Shown on the first load; a few list placeholders by default. Never "Rs 0". */
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  /** The error banner's second button (see ErrorBanner `extraAction`). */
  errorAction?: ErrorBannerAction | null;
  /** A button under "Nothing saved yet." (the driver's trip and step screens: "Call office"). */
  offlineAction?: ErrorBannerAction | null;
  children: (data: T) => ReactNode;
}

/** "4:12 pm" for today, otherwise "Yesterday, 9:05 am" / "Mon 19 Oct, 4:12 pm". */
function savedAt(updatedAt: number): string {
  const now = Date.now();
  return localDate(updatedAt) === localDate(now) ? formatPkTime(updatedAt) : formatWhenText(updatedAt, now);
}

/**
 * The states every list and detail screen has (UX_MOBILE §2.2 #16; UX_PRINCIPLES §7.5):
 * - first load: a skeleton;
 * - no data and no answer: "Nothing saved yet." under the one "No connection" banner, never a red card;
 * - no data and a server error: an ErrorBanner with "Try again";
 * - saved data and a failed refresh: the data under a "Saved 4:12 pm" strip, which offers "Try again"
 *   while the banner (which has its own) isn't showing;
 * - the empty state.
 *
 * With data, fresh and stale render the same shape: the strip's slot is empty while fresh, and the data
 * keeps its place in its View. A background refresh that fails or recovers never remounts the data, so
 * an open sheet keeps its reason, note and spinner, and a stepper keeps its count.
 */
export function QueryBoundary<T>({
  query,
  skeleton,
  isEmpty,
  empty,
  errorAction,
  offlineAction,
  children,
}: QueryBoundaryProps<T>) {
  const retry = () => void query.refetch();

  if (query.data === undefined) {
    if (query.isError) {
      return <NoData error={query.error} onRetry={retry} errorAction={errorAction} offlineAction={offlineAction} />;
    }
    return <>{skeleton ?? <SkeletonList rows={3} />}</>;
  }

  const data = query.data;
  const body = isEmpty?.(data) && empty !== undefined ? empty : children(data);
  return (
    <>
      {query.isError ? <StaleStrip updatedAt={query.dataUpdatedAt} onRetry={retry} /> : null}
      <View>{body}</View>
    </>
  );
}

/** Nothing to show: the calm offline block for no answer, the ErrorBanner for a server error. */
function NoData({
  error,
  onRetry,
  errorAction,
  offlineAction,
}: {
  error: unknown;
  onRetry: () => void;
  errorAction?: ErrorBannerAction | null;
  offlineAction?: ErrorBannerAction | null;
}) {
  if (isNoAnswer(error)) return <OfflineEmpty onRetry={onRetry} action={offlineAction} />;
  return <ErrorBanner error={error} onRetry={onRetry} extraAction={errorAction} />;
}

/**
 * "Saved 4:12 pm" over the cached data, with the `history` icon (the clock means waiting, and only
 * that). It is the strip's own "Try again" while the "No connection" banner isn't showing.
 */
function StaleStrip({ updatedAt, onRetry }: { updatedAt: number; onRetry: () => void }) {
  const { t } = useTranslation();
  const bannerShowing = useNoConnection();
  const surface = toneSurfaces.warning;
  const strip = t('common.stale', { time: savedAt(updatedAt) });
  const words = (
    <>
      <Icon name="history" size={20} tone={surface.icon} />
      <Text variant="caption" style={[styles.stripText, { color: surface.text }]}>
        {strip}
      </Text>
    </>
  );
  if (bannerShowing) {
    return (
      <View accessible accessibilityLabel={strip} style={[styles.strip, { backgroundColor: surface.background }]}>
        {words}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel={strip}
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
    marginBottom: space.md,
  },
  stripText: { flex: 1 },
});
