import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { errorAction, isNetworkError, toUserMessage } from '../api/errors';
import { signOut } from '../api/session';
import { useAppConfig, useOfficeContact } from '../hooks/useAppConfig';
import { useNoConnection } from '../store/appStatus';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, radius, space, toneSurfaces } from './tokens';

/**
 * QueryBoundary reads the connection state from here, not from its own module: it imports only this
 * module, Icon, Skeleton, Text and tokens (the REV mobile-ux-06 test stubs exactly those).
 */
export { useNoConnection };

export interface ErrorBannerAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
}

/**
 * The second button an error offers. Given (`extraAction`), that one; `null`, none; left out, the
 * error's own action where it needs no screen to do it: "Call office" (when a number is known),
 * "Sign in" or "Update the app" (`errorAction`). ADD_MONEY needs the screen's navigation, so the
 * screen passes it.
 */
export function useErrorExtraAction(error: unknown, extraAction?: ErrorBannerAction | null): ErrorBannerAction | null {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const { config } = useAppConfig();
  if (extraAction !== undefined) return extraAction;
  if (error === null || error === undefined || typeof error === 'string') return null;
  const action = errorAction(error);
  if (action === 'CALL_OFFICE' && office.phone) {
    return { label: t('common.actions.callOffice'), onPress: office.call, icon: 'call' };
  }
  if (action === 'SIGN_IN') return { label: t('common.actions.signIn'), onPress: () => void signOut() };
  if (action === 'UPDATE_APP' && config.links.updateUrl) {
    const url = config.links.updateUrl;
    return { label: t('common.actions.updateApp'), onPress: () => void Linking.openURL(url).catch(() => undefined) };
  }
  return null;
}

export interface ErrorBannerProps {
  /** An ApiError (or anything thrown), or words that are already translated. */
  error: unknown;
  /** Shows a 48 dp "Try again". */
  onRetry?: () => void;
  /**
   * The second button. When left out, the error's own action is offered where the banner can do it
   * alone: "Call office", "Sign in" or "Update the app" (`errorAction`). Pass `null` for none; pass
   * an action for ADD_MONEY, which needs the screen's navigation.
   */
  extraAction?: ErrorBannerAction | null;
  tone?: 'danger' | 'warning';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * An inline error, never a pop-up (UX_MOBILE §2.2 #15): the mapped message, "Try again" and an
 * optional extra action. It is announced to screen readers.
 */
export function ErrorBanner({ error, onRetry, extraAction, tone = 'danger', style, testID }: ErrorBannerProps) {
  const { t } = useTranslation();
  const message = toUserMessage(error, t);
  const extra = useErrorExtraAction(error, extraAction);
  const surface = toneSurfaces[tone];

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.banner, { backgroundColor: surface.background }, style]}
    >
      <View style={styles.row}>
        <Icon name={tone === 'warning' ? 'warn' : 'error'} size={24} tone={surface.icon} />
        <Text style={styles.message}>{message}</Text>
      </View>
      {onRetry || extra ? (
        <View style={styles.actions}>
          {onRetry ? (
            <Button label={t('common.actions.tryAgain')} onPress={onRetry} variant="secondary" fullWidth={false} />
          ) : null}
          {extra ? (
            <Button label={extra.label} onPress={extra.onPress} icon={extra.icon} variant="secondary" fullWidth={false} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export interface OfflineEmptyProps {
  /** Loads again. Offered only once the "No connection" banner (which has its own) has gone. */
  onRetry?: () => void;
  /** A second button, e.g. "Call office" on the driver's trip and step screens. */
  action?: ErrorBannerAction | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * No data and no answer (UX_PRINCIPLES §7.5; driver spec S3): a calm block with the `offline` icon
 * and "Nothing saved yet." under the one "No connection" banner. Never a red card, and never one per
 * query: a screen with several queries shows this once.
 */
export function OfflineEmpty({ onRetry, action, style, testID }: OfflineEmptyProps) {
  const { t } = useTranslation();
  const bannerShowing = useNoConnection();
  const retry = !bannerShowing ? onRetry : undefined;
  return (
    <View testID={testID} style={[styles.offline, style]} accessibilityLiveRegion="polite">
      <View style={styles.offlineBadge}>
        <Icon name="offline" size={32} tone="secondary" />
      </View>
      <Text tone="secondary" align="center">
        {t('common.offlineEmpty')}
      </Text>
      {retry || action ? (
        <View style={styles.offlineActions}>
          {retry ? (
            <Button label={t('common.actions.tryAgain')} onPress={retry} variant="secondary" fullWidth={false} />
          ) : null}
          {action ? (
            <Button label={action.label} onPress={action.onPress} icon={action.icon} variant="secondary" fullWidth={false} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export interface FirstLoadStateProps {
  /** The query's error, once its retries are over. */
  error: unknown;
  isError: boolean;
  /** The screen's own skeleton, in its final layout. */
  skeleton: ReactNode;
  onRetry: () => void;
  /** The ErrorBanner's second button (see ErrorBanner `extraAction`). */
  errorAction?: ErrorBannerAction | null;
  /** A button under "Nothing saved yet." (the driver's trip and step screens: "Call office"). */
  offlineAction?: ErrorBannerAction | null;
}

/**
 * A screen's body before its first answer (UX_PRINCIPLES §7.5): the skeleton while it loads, then the
 * server's error with Try again. With no connection (the banner is up) it is "Nothing saved yet." at
 * once: the retries can take a while, and a skeleton that never fills under "No connection" reads as
 * broken. The query keeps retrying, so the data still shows the moment it arrives.
 */
export function FirstLoadState({ error, isError, skeleton, onRetry, errorAction, offlineAction }: FirstLoadStateProps) {
  const bannerShowing = useNoConnection();
  if (isError && !isNetworkError(error)) {
    return <ErrorBanner error={error} onRetry={onRetry} extraAction={errorAction} />;
  }
  if (isError || bannerShowing) return <OfflineEmpty onRetry={onRetry} action={offlineAction} />;
  return <>{skeleton}</>;
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius.md, padding: space.md, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  message: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  offline: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.md },
  offlineBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
});
