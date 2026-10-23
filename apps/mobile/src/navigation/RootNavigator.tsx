import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { UserRoleValue } from '@smartfleet/shared-types';
import { APP_VERSION, isVersionBelow, type MobileVariant } from '../api/appInfo';
import { useAppConfig } from '../hooks/useAppConfig';
import { SignInScreen } from '../screens/auth/SignInScreen';
import { UpdateRequiredScreen } from '../screens/auth/UpdateRequiredScreen';
import { WrongAppScreen } from '../screens/auth/WrongAppScreen';
import { useAppStatusStore } from '../store/appStatus';
import { useAuthStore } from '../store/auth';
import { colors, space, Text } from '../ui';
import { DistributorStack } from './DistributorStack';
import { DriverStack } from './DriverStack';

/** The signed-out stack: Sign in only (the OTP screen and the customer app left navigation). */
export type AuthStackParams = {
  SignIn: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParams>();

/** The role each build serves (UX_MOBILE §3.6 gate 3). */
const ROLE_FOR_VARIANT: Record<MobileVariant, UserRoleValue> = {
  distributor: 'DISTRIBUTOR',
  driver: 'DRIVER',
};

interface Props {
  variant: MobileVariant;
}

/**
 * The shell's gates, in order (UX_MOBILE §3.6):
 * 1. UpdateRequired, on `APP_UPDATE_REQUIRED` or when `appConfig.minVersion` is above this build;
 * 2. SignIn, with no session;
 * 3. WrongApp, unless the shop build has a DISTRIBUTOR or the driver build a DRIVER;
 * 4. the app's stack.
 */
export function RootNavigator({ variant }: Props) {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const loading = useAuthStore((s) => s.loading);
  const init = useAuthStore((s) => s.init);
  const updateRequired = useAppStatusStore((s) => s.updateRequired);
  const { config } = useAppConfig();

  useEffect(() => {
    void init();
  }, [init]);

  if (updateRequired || isVersionBelow(APP_VERSION, config.minVersion[variant])) {
    return <UpdateRequiredScreen />;
  }

  if (loading) return <SessionLoading />;

  if (!token) {
    return (
      <AuthStack.Navigator screenOptions={{ headerShown: false }}>
        <AuthStack.Screen name="SignIn" component={SignInScreen} />
      </AuthStack.Navigator>
    );
  }

  if (role !== ROLE_FOR_VARIANT[variant]) {
    return <WrongAppScreen role={role} variant={variant} />;
  }

  return variant === 'driver' ? <DriverStack /> : <DistributorStack />;
}

/** While the saved session is read from secure storage (a moment at boot). */
function SessionLoading() {
  const { t } = useTranslation();
  return (
    <View style={styles.loading} accessibilityLabel={t('common.loading')}>
      <ActivityIndicator size="large" color={colors.brand} />
      <Text tone="secondary">{t('common.loading')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    backgroundColor: colors.canvas,
  },
});
