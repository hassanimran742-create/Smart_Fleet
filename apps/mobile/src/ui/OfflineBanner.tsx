import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useNoConnection } from '../store/appStatus';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';
import { space, toneSurfaces } from './tokens';

/**
 * The one connection message (UX_MOBILE §2.2 #23; UX_PRINCIPLES rule 8; DECIDED: "No connection ·
 * Try again" in every app): it is true both with no signal and when our server is down. It shows for
 * 30 seconds after a request got no answer and hides as soon as one gets through (from the 0.2.0 APK
 * NetInfo drives it). "Try again" (48 / 56 dp) refetches the screen's queries. While it shows,
 * screens add no network error of their own.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const visible = useNoConnection();
  const client = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  if (!visible) return null;
  const surface = toneSurfaces.warning;

  const retry = () => {
    setRetrying(true);
    // The config query is on every screen (the training banner), so there is always one to send;
    // the first answer hides the banner.
    void client.refetchQueries({ type: 'active' }).finally(() => setRetrying(false));
  };

  return (
    <View style={[styles.strip, { backgroundColor: surface.background }]}>
      <Icon name="offline" size={20} tone={surface.icon} />
      <Text
        variant="label"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.text, { color: surface.text }]}
      >
        {t('common.offline')}
      </Text>
      <Button
        label={t('common.actions.tryAgain')}
        onPress={retry}
        loading={retrying}
        variant="secondary"
        fullWidth={false}
        testID="offline.tryAgain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    paddingStart: space.lg,
    paddingEnd: space.sm,
  },
  text: { flex: 1 },
});
