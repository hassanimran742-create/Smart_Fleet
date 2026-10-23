import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { useLocationPaused } from '../../hooks/useLiveLocation';
import {
  Icon,
  Screen,
  Text,
  radius,
  sizes,
  space,
  toneSurfaces,
  type ErrorBannerAction,
  type IconName,
  type ScreenProps,
  type Tone,
} from '../../ui';

/**
 * The frame of every driver screen: the shared Screen (training and offline strips, the sticky
 * footer) plus "Location paused, no connection" while live location can't get through (UX_MOBILE §5).
 */
export function DriverScreen({ banner, ...props }: ScreenProps) {
  return (
    <Screen
      {...props}
      banner={
        <>
          {banner}
          <LocationPausedBanner />
        </>
      }
    />
  );
}

/** "Location paused, no connection" after 30 seconds without a connection while on duty. */
export function LocationPausedBanner() {
  const { t } = useTranslation();
  const paused = useLocationPaused();
  if (!paused) return null;
  const surface = toneSurfaces.warning;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: surface.background }]}
      testID="driver.locationPaused"
    >
      <Icon name="offline" size={20} tone={surface.icon} />
      <Text variant="label" style={[styles.bannerText, { color: surface.text }]}>
        {t('driver.location.paused')}
      </Text>
    </View>
  );
}

export interface NoticeStripProps {
  tone: Tone;
  message: string;
  icon?: IconName;
  testID?: string;
}

/** An inline result line, such as "Marked delivered.", never a pop-up. Announced to screen readers. */
export function NoticeStrip({ tone, message, icon, testID }: NoticeStripProps) {
  const surface = toneSurfaces[tone];
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: surface.background }]}
    >
      {icon ? <Icon name={icon} size={24} tone={surface.icon} /> : null}
      <Text variant="bodyStrong" style={[styles.noticeText, { color: surface.text }]}>
        {message}
      </Text>
    </View>
  );
}

/** A label above its value, for read-only details (Profile, Help). */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

/** "Call the office" for an error banner or a refusal, when the office's phone is set. */
export function useCallOfficeAction(): ErrorBannerAction | null {
  const { t } = useTranslation();
  const office = useOfficeContact();
  return office.phone ? { label: t('common.actions.callTheOffice'), onPress: office.call, icon: 'call' } : null;
}

/** Pull to refresh: runs every refetch and shows the spinner until all have answered. */
export function usePullToRefresh(...refetches: Array<() => Promise<unknown>>): {
  refreshing: boolean;
  onRefresh: () => void;
} {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    void Promise.all(refetches.map((refetch) => refetch().catch(() => undefined))).finally(() =>
      setRefreshing(false),
    );
  };
  return { refreshing, onRefresh };
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  bannerText: { flex: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: sizes.touch,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  noticeText: { flex: 1 },
  infoRow: {
    gap: space.xs,
    paddingVertical: space.sm,
  },
});
