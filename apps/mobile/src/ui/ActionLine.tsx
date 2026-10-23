import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { isNetworkError, toUserMessage } from '../api/errors';
import { Button } from './Button';
import { useErrorExtraAction, type ErrorBannerAction } from './ErrorBanner';
import { Icon } from './Icon';
import { Text } from './Text';
import { space } from './tokens';

export interface ActionLineProps {
  /** What the button's own request failed with (an ApiError, or translated words). Nothing shows without one. */
  error: unknown;
  /**
   * The words when the request got no answer. Default "Not sent. Tap again."; the two money buttons
   * pass "Not sent. Tap again. It won't be sent twice." (shop spec §3.1).
   */
  notSentLabel?: string;
  /**
   * Inside a sheet the "No connection" banner is hidden behind the scrim, so a request with no answer
   * shows the shared network message instead of `notSentLabel`.
   */
  inSheet?: boolean;
  /** A 48 dp ghost button in the same line. Left out: the error's own ("Call office"…); `null`: none. */
  extraAction?: ErrorBannerAction | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The action line (UX_PRINCIPLES §7.3; shop spec §3.1, driver spec S5): when a footer or sheet
 * button's own request fails, one line sits directly above that button, with the `error` icon, in
 * danger text. It states the outcome, not the cause. It has no "Try again": the button is the retry.
 */
export function ActionLine({ error, notSentLabel, inSheet = false, extraAction, style, testID }: ActionLineProps) {
  const { t } = useTranslation();
  const extra = useErrorExtraAction(error, extraAction);
  if (error === null || error === undefined || error === '') return null;
  const message =
    !inSheet && isNetworkError(error) ? notSentLabel ?? t('common.notSent') : toUserMessage(error, t);
  return (
    <View testID={testID} style={[styles.line, style]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <View style={styles.words}>
        <Icon name="error" size={20} tone="danger" />
        <Text variant="caption" tone="danger" style={styles.message}>
          {message}
        </Text>
      </View>
      {extra ? (
        <Button
          label={extra.label}
          onPress={extra.onPress}
          icon={extra.icon}
          variant="ghost"
          fullWidth={false}
          style={styles.extra}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm },
  words: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexGrow: 1, flexShrink: 1, flexBasis: 160 },
  message: { flex: 1 },
  extra: { paddingHorizontal: space.sm },
});
