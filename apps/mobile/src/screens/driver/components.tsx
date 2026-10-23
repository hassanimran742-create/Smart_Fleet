import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatIsoDay } from '@smartfleet/shared-utils';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import { useLocationPaused } from '../../hooks/useLiveLocation';
import type { DriverStackParams } from '../../navigation/DriverStack';
import {
  Button,
  Icon,
  Screen,
  Skeleton,
  SkeletonLines,
  Text,
  colors,
  radius,
  sizes,
  space,
  toneSurfaces,
  useNoConnection,
  type ErrorBannerAction,
  type IconName,
  type ScreenProps,
  type Tone,
} from '../../ui';
import { cameraHeightFor } from '../../ui/scan';
import { businessDayOf, customerNameOf, nextStep, orderOf, type NextStep, type TripView } from './tripModel';

type DriverNav = NativeStackNavigationProp<DriverStackParams>;

export interface DriverScreenProps extends ScreenProps {
  /** The "Location paused" strip. Today says it in its duty row instead, so it passes false. */
  locationStrip?: boolean;
}

/**
 * The frame of every driver screen (driver spec §1.1): the shared Screen (the training strip, the one
 * "No connection" banner, the sticky footer) plus "Location paused" while live location can't get
 * through. At most one strip is about the network.
 */
export function DriverScreen({ banner, locationStrip = true, ...props }: DriverScreenProps) {
  return (
    <Screen
      {...props}
      banner={
        <>
          {banner}
          {locationStrip ? <LocationPausedBanner /> : null}
        </>
      }
    />
  );
}

/**
 * "Location paused" after 30 seconds on duty without live location getting through. Hidden while the
 * "No connection" banner shows: they have the same cause, so the screen says it once.
 */
export function LocationPausedBanner() {
  const { t } = useTranslation();
  const paused = useLocationPaused();
  const noConnection = useNoConnection();
  if (!paused || noConnection) return null;
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
  /** A second line, e.g. "Bring the cylinders back to the store." under "Not delivered". */
  detail?: string;
  icon?: IconName;
  testID?: string;
}

/**
 * A full-width state card (rulebook §9.3: the step's state is a strip, not a small chip): "Loading
 * done", "Visit done", "Not delivered", "This trip is closed.". The icon is 32 dp in the driver app.
 * Announced to screen readers; never a pop-up.
 */
export function NoticeStrip({ tone, message, detail, icon, testID }: NoticeStripProps) {
  const surface = toneSurfaces[tone];
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: surface.background }]}
    >
      {icon ? <Icon name={icon} size={32} tone={surface.icon} /> : null}
      <View style={styles.noticeWords}>
        <Text variant="bodyStrong" style={{ color: surface.text }}>
          {message}
        </Text>
        {detail ? <Text style={{ color: surface.text }}>{detail}</Text> : null}
      </View>
    </View>
  );
}

/** A label above its value, for read-only details (Help's "You" card). */
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

/**
 * "Call office" for a boundary, a sheet's error line or a refusal (driver spec S3, S14), whenever an
 * office number is known (also offline: the saved one).
 */
export function useCallOfficeAction(): ErrorBannerAction | null {
  const { t } = useTranslation();
  const office = useOfficeContact();
  return office.phone ? { label: t('common.actions.callOffice'), onPress: office.call, icon: 'call' } : null;
}

/** Pull to refresh: runs every refetch and shows the spinner until all have answered. */
export function usePullToRefresh(...refetches: Array<() => Promise<unknown>>): {
  refreshing: boolean;
  onRefresh: () => void;
} {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    void Promise.all(refetches.map((refetch) => refetch().catch(() => undefined))).finally(() => setRefreshing(false));
  };
  return { refreshing, onRefresh };
}

/** Today's header: "Today · Thu 22 Oct", the business date (the day starts at the cut-off). */
export function useTodayTitle(): string {
  const { t } = useTranslation();
  const { config } = useAppConfig();
  return t('driver.nav.homeDate', { date: formatIsoDay(businessDayOf(Date.now(), config.day)) });
}

export interface StepFrameProps {
  /** A state strip above the title, e.g. "All delivered" while taking back. */
  notice?: ReactNode;
  /** The verb and the place: "Load at Ahmed Gas Store". Wraps to two lines, never cut. */
  title: string;
  /** A line under the title (the customer's address, data). */
  subtitle?: string;
  /** The CountBar while scanning; the state card once the step has ended. */
  count?: ReactNode;
  /** The camera and its result strip (ScanPanel). */
  scan?: ReactNode;
  /** What to load or give (SizeLines), and on the way the Maps and Call buttons. */
  details?: ReactNode;
  /** Rare actions ("Could not deliver"), last, 24 dp below the rest. */
  rare?: ReactNode;
  testID?: string;
}

/**
 * The step screen (driver spec §1.2), the same order on every step so it never drifts: title, count,
 * camera, result strip, details, then the rare actions. The footer, outside the scroll, holds the one
 * button, so nothing hides under it.
 */
export function StepFrame({ notice, title, subtitle, count, scan, details, rare, testID }: StepFrameProps) {
  return (
    <View style={styles.frame} testID={testID}>
      {notice}
      <View style={styles.heading}>
        <Text variant="title">{title}</Text>
        {subtitle ? <Text tone="secondary">{subtitle}</Text> : null}
      </View>
      {count}
      {scan}
      {details}
      {rare ? <View style={styles.rare}>{rare}</View> : null}
    </View>
  );
}

/** A step screen's first load: the title, the count, the camera as a dark block and the size lines. */
export function StepSkeleton() {
  const { height } = useWindowDimensions();
  return (
    <View style={styles.frame}>
      <Skeleton width="70%" height={30} />
      <View style={styles.skeletonCard}>
        <Skeleton width="45%" height={44} />
        <Skeleton height={8} />
      </View>
      <View style={[styles.skeletonCamera, { height: cameraHeightFor(height) }]} />
      <SkeletonLines lines={2} />
    </View>
  );
}

/** Opens a step from Today with the Trip screen under it, so the step's back arrow goes to the trip. */
export function openStepFromToday(navigation: Pick<DriverNav, 'navigate'>, trip: TripView, next: NextStep): void {
  navigation.navigate('ActiveTrip', { tripId: trip.id });
  if (next.kind === 'LOAD' || next.kind === 'DELIVER')
    navigation.navigate('DeliverySteps', { tripId: trip.id, stopId: next.stop.id });
  else if (next.kind === 'UNLOAD') navigation.navigate('Unload', { tripId: trip.id });
}

export interface NextStepButtonProps {
  trip: TripView;
  vanHasCylinders: boolean;
  /**
   * `step`: from a finished step, the next step replaces it (back still goes to the Trip screen);
   * `trip`: from the Trip screen, the step opens over it.
   */
  from: 'step' | 'trip';
  /** "Finish trip": opens the finish sheet. */
  onFinish: () => void;
}

/**
 * The footer's one button for what comes next (driver spec D6 table): "Load at store", "Deliver to
 * {{name}}", "Unload at store" or "Finish trip"; "Back to trip" or "Back to home" once the trip has
 * closed. Labels never start with "Next:". "Start trip" is the caller's, because it sends a request.
 */
export function NextStepButton({ trip, vanHasCylinders, from, onFinish }: NextStepButtonProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<DriverNav>();
  const tripId = trip.id;
  const openStop = (stopId: string) => {
    if (from === 'step') navigation.replace('DeliverySteps', { tripId, stopId });
    else navigation.navigate('DeliverySteps', { tripId, stopId });
  };
  const openUnload = () => {
    if (from === 'step') navigation.replace('Unload', { tripId });
    else navigation.navigate('Unload', { tripId });
  };
  const next = nextStep(trip, vanHasCylinders);

  switch (next.kind) {
    case 'LOAD':
      return (
        <Button label={t('driver.trip.goLoad')} icon="van" onPress={() => openStop(next.stop.id)} testID="next.load" />
      );
    case 'DELIVER':
      return (
        <Button
          label={t('driver.trip.deliverTo', { name: customerNameOf(orderOf(trip, next.stop), t) })}
          icon="customer"
          onPress={() => openStop(next.stop.id)}
          testID="next.deliver"
        />
      );
    case 'UNLOAD':
      return <Button label={t('driver.trip.goUnload')} icon="store" onPress={openUnload} testID="next.unload" />;
    case 'FINISH':
      return <Button label={t('driver.trip.finish')} icon="ok" onPress={onFinish} testID="next.finish" />;
    case 'START':
    case 'CLOSED':
      return from === 'step' ? (
        <Button
          label={t('driver.steps.backToTrip')}
          onPress={() => navigation.navigate('ActiveTrip', { tripId })}
          testID="next.backToTrip"
        />
      ) : (
        <Button label={t('driver.trip.backHome')} onPress={() => navigation.navigate('Home')} testID="next.backHome" />
      );
  }
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
    gap: space.md,
    minHeight: sizes.touch,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  noticeWords: { flex: 1, gap: space.xs },
  infoRow: {
    gap: space.xs,
    paddingVertical: space.sm,
  },
  frame: { gap: space.md },
  heading: { gap: space.xs },
  rare: { marginTop: space.xl - space.md, gap: space.lg },
  skeletonCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skeletonCamera: { borderRadius: radius.lg, backgroundColor: colors.text },
});
