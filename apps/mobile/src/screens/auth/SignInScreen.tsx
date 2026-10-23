import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextInput } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import type { LoginResponse } from '@smartfleet/shared-types';
import { normalizePkPhone } from '@smartfleet/shared-utils';
import { APP_VARIANT } from '../../api/appInfo';
import { api } from '../../api/client';
import { errorAction, type ApiError } from '../../api/errors';
import { clearAccountData } from '../../api/queryClient';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { readLastPhone, saveLastPhone, useAuthStore } from '../../store/auth';
import { ActionLine, Button, Field, Icon, PhoneField, Screen, Text, colors, radius, space } from '../../ui';

const FULL_SCREEN = ['top', 'left', 'right', 'bottom'] as const;

interface LoginBody {
  phone: string;
  password: string;
}

async function login(body: LoginBody): Promise<LoginResponse> {
  // A wrong password is a 401 too: it must not try to renew a session.
  const { data } = await api.post<LoginResponse>('/auth/login', body, { skipAuth: true, skipAuthRefresh: true });
  return data;
}

/**
 * S1 Sign in, one screen for both apps (shop spec §A, driver spec D1): the app's name, the mobile
 * number (prefilled with the last good sign-in) and the password. The footer holds the error line,
 * "Sign in" and the ghost "Forgot password?", which calls the office. The server refuses an account of
 * the other app (`AUTH_WRONG_APP`) because every request names the build in `X-App-Variant`.
 */
export function SignInScreen() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const typedPhone = useRef(false);

  // The last signed-in number, unless the person has started typing one.
  useEffect(() => {
    let active = true;
    void readLastPhone().then((saved) => {
      if (active && saved && !typedPhone.current) setPhone(saved);
    });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useMutation<LoginResponse, ApiError, LoginBody>({
    mutationFn: login,
    onSuccess: async (data, body) => {
      // Nothing from an earlier session may show for this account.
      clearAccountData({ keepMutations: true });
      await saveLastPhone(body.phone);
      await useAuthStore.getState().set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        role: data.role,
      });
    },
  });

  const submit = () => {
    if (signIn.isPending) return;
    const e164 = normalizePkPhone(phone);
    setPhoneError(e164 ? null : t('auth.signIn.phoneInvalid'));
    setPasswordError(password ? null : t('auth.signIn.passwordRequired'));
    if (!e164 || !password) return;
    signIn.mutate({ phone: e164, password });
  };

  // Typing clears the error line: it was about the last try.
  const editing = (apply: () => void) => {
    apply();
    if (signIn.isError) signIn.reset();
  };

  const error = signIn.error;
  // Only "Call office" belongs here: a refused password must not offer "Sign in" again.
  const callOffice =
    error && errorAction(error) === 'CALL_OFFICE' && office.phone
      ? { label: t('common.actions.callOffice'), onPress: office.call, icon: 'call' as const }
      : null;
  const busy = signIn.isPending;

  return (
    <Screen
      edges={FULL_SCREEN}
      footer={
        <>
          <ActionLine error={error} extraAction={callOffice} testID="signIn.error" />
          <Button
            label={t('auth.signIn.submit')}
            loadingLabel={t('auth.signIn.submitting')}
            loading={busy}
            onPress={submit}
            size="lg"
            testID="signIn.submit"
          />
          {office.phone ? (
            <Button
              label={t('auth.signIn.forgot')}
              accessibilityLabel={t('auth.signIn.forgotA11y')}
              onPress={office.call}
              variant="ghost"
              icon="call"
              testID="signIn.forgot"
            />
          ) : null}
        </>
      }
    >
      <View style={styles.brand}>
        <View style={styles.mark}>
          <Icon name="truck" size={32} tone="onBrand" />
        </View>
        <Text variant="title" align="center">
          {t('common.appName')}
        </Text>
        <Text tone="secondary" align="center">
          {t(`auth.signIn.subtitle_${APP_VARIANT}`)}
        </Text>
      </View>

      <View style={styles.form}>
        <PhoneField
          label={t('auth.signIn.phone')}
          placeholder={t('auth.signIn.phonePlaceholder')}
          value={phone}
          onChangeText={(text) =>
            editing(() => {
              typedPhone.current = true;
              setPhone(text);
              if (phoneError) setPhoneError(null);
            })
          }
          onBlur={(e164) => {
            if (phone.trim()) setPhoneError(e164 ? null : t('auth.signIn.phoneInvalid'));
          }}
          error={phoneError}
          editable={!busy}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="signIn.phone"
        />
        <Field
          inputRef={passwordRef}
          label={t('auth.signIn.password')}
          value={password}
          onChangeText={(text) =>
            editing(() => {
              setPassword(text);
              if (passwordError) setPasswordError(null);
            })
          }
          secure={!showPassword}
          autoCapitalize="none"
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          error={passwordError}
          editable={!busy}
          rightAction={{
            label: showPassword ? t('auth.signIn.hide') : t('auth.signIn.show'),
            accessibilityLabel: showPassword ? t('auth.signIn.hidePassword') : t('auth.signIn.showPassword'),
            onPress: () => setShowPassword((shown) => !shown),
          }}
          testID="signIn.password"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: space.sm, marginTop: space.xl, marginBottom: space.xl },
  mark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  form: { gap: space.lg },
});
