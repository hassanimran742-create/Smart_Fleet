import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { AppEnvironment } from '@smartfleet/shared-types';
import { BUILD_ENVIRONMENT } from '../api/appInfo';
import { useAppConfig } from '../hooks/useAppConfig';
import { Text } from './Text';
import { colors, space } from './tokens';

type BannerKey = 'common.env.training' | 'common.env.test';

function bannerFor(environment: AppEnvironment, training: boolean): BannerKey | null {
  if (training || environment === 'training') return 'common.env.training';
  if (environment === 'production') return null;
  return 'common.env.test';
}

/**
 * The top strip on a training or test server (UX_MOBILE §2.2 #22): "Training · test money only" or
 * "Test server · test money only", in sentence case (UX_PRINCIPLES §5.1).
 * The server's `appConfig.environment` decides; the build's `EXPO_PUBLIC_ENV` is the fallback until
 * it answers. Production shows nothing.
 */
export function EnvBanner() {
  const { t } = useTranslation();
  const { config, isLoaded } = useAppConfig();
  const key = isLoaded
    ? bannerFor(config.environment, config.training)
    : bannerFor(BUILD_ENVIRONMENT, BUILD_ENVIRONMENT === 'training');
  if (!key) return null;
  return (
    <View style={styles.strip} accessibilityRole="text">
      <Text variant="label" tone="onBrand" align="center">
        {t(key)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: colors.warning,
    paddingVertical: space.xs,
    paddingHorizontal: space.lg,
  },
});
