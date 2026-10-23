import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import type { LoginResponse } from '@smartfleet/shared-types';
import { loginSchema, type LoginInput } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useApiMutation } from '../../api/useApiMutation';
import { resolveEnvKind, type EnvKind } from '../../app/env';
import { SessionEndedNotice } from '../../app/RoleGate';
import { useAppConfig } from '../../hooks/useAppConfig';
import { isOfficeRole, useAuthStore } from '../../store/auth';
import { Button, EnvBadge, Field, InlineAlert, PhoneInput, TextInput, useZodForm } from '../../ui';
import './auth.css';

/** Keeps the browser tab's title on the sign-in pages: "Sign in · Smart Fleet Office", "[TEST] …" off live. */
export function useSignedOutTitle(page: string, env: EnvKind): void {
  const { t } = useTranslation('common');
  useEffect(() => {
    const title = t('documentTitle.page', { page, app: t('appName') });
    document.title = env === 'live' ? title : t('documentTitle.env', { prefix: t('env.titlePrefix'), title });
  }, [env, page, t]);
}

/**
 * Sign-in (UX_ADMIN §2.10): mobile number and password, nothing prefilled. The server refuses every
 * account that isn't for this website (`AUTH_WRONG_APP`, `AUTH_ROLE_LOCKED`), and each refusal shows
 * under the form with no session started. A non-office role that still gets tokens (an older API) is
 * refused here too, so nobody who isn't office staff stays signed in; the role-gate page is only the
 * fallback for a saved session. The typed password never leaves this form except in the request.
 */
export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { config } = useAppConfig();
  const env = resolveEnvKind(config.environment);
  useSignedOutTitle(t('signIn.documentTitle'), env);

  const form = useZodForm(loginSchema, { phone: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [notOffice, setNotOffice] = useState(false);

  const login = useApiMutation({
    mutationFn: (body: LoginInput) => api.post<LoginResponse>('/auth/login', body).then((response) => response.data),
  });

  const submit = form.handleSubmit((body) => {
    setNotOffice(false);
    login.mutate(body, {
      onSuccess: (session) => {
        if (!isOfficeRole(session.role)) {
          setNotOffice(true);
          return;
        }
        useAuthStore.getState().set({ token: session.accessToken, refreshToken: session.refreshToken, role: session.role });
      },
      onError: (error) => form.setServerError(error),
    });
  });

  const problem = notOffice ? t('signIn.notOffice') : form.formError;

  return (
    <div className="sf-signin">
      <EnvBadge kind={env} />
      <main className="sf-signin__main">
        <div className="sf-signin__panel">
          <SessionEndedNotice />
          <form className="sf-signin__card" onSubmit={submit} noValidate aria-labelledby="signin-title">
            <div className="sf-signin__brand" aria-hidden>
              <LogIn size={22} strokeWidth={2} />
            </div>
            <h1 id="signin-title" className="sf-signin__title">
              {t('signIn.title')}
            </h1>
            <p className="sf-signin__subtitle">{t('signIn.subtitle')}</p>

            <Field label={t('signIn.phone')} error={form.errorFor('phone')}>
              <PhoneInput
                name="phone"
                autoComplete="username"
                value={form.values.phone ?? ''}
                // The box sends the number again when it loses focus: only a real change clears an error.
                onChange={(value) => {
                  if (value !== form.values.phone) form.setValue('phone', value);
                }}
                onBlur={() => form.touch('phone')}
              />
            </Field>

            <Field label={t('signIn.password')} error={form.errorFor('password')}>
              <TextInput
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={form.values.password ?? ''}
                onChange={(event) => form.setValue('password', event.target.value)}
                onBlur={() => form.touch('password')}
                endAdornment={
                  <button
                    type="button"
                    className="sf-signin__reveal"
                    aria-label={showPassword ? t('signIn.hideLabel') : t('signIn.showLabel')}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? t('signIn.hide') : t('signIn.show')}
                  </button>
                }
              />
            </Field>

            {problem ? (
              <InlineAlert tone="danger" live className="sf-signin__error">
                {problem}
              </InlineAlert>
            ) : null}

            <Button type="submit" variant="primary" size="lg" loading={login.isPending} className="sf-signin__submit">
              {t('signIn.submit')}
            </Button>
          </form>
          <p className="sf-signin__footer">{t('signIn.footer')}</p>
        </div>
      </main>
    </div>
  );
}
