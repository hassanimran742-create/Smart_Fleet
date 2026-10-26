import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { EmptyState, Screen } from '../../ui';

/**
 * The one-time-code screen, retired: OTP login is off for the pilot (`auth.otpLogin.enabled=false`,
 * ADR-03) and the server answers 403 `AUTH_OTP_DISABLED`. The file is kept out of navigation
 * (UX_MOBILE Appendix A); if it is ever opened it sends the person back to the password sign-in.
 */
export function OtpScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  return (
    <Screen>
      <EmptyState
        icon="lock"
        title={t('errors.AUTH_OTP_DISABLED')}
        action={
          navigation.canGoBack()
            ? { label: t('auth.otp.back'), onPress: () => navigation.goBack(), variant: 'primary' }
            : undefined
        }
      />
    </Screen>
  );
}
