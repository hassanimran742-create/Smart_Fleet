import { useEffect, useRef, useState } from 'react';
import { Cylinder } from 'lucide-react';
import type { LoginResponse } from '@smartfleet/shared-types';
import { loginSchema, type LoginInput } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorDetails, toApiError } from '../../api/errors';
import { useApiMutation } from '../../api/useApiMutation';
import { resolveEnvKind, type EnvKind } from '../../app/env';
import { SessionEndedNotice } from '../../app/RoleGate';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useNow } from '../../hooks/useNow';
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

/** "9:42": minutes and seconds left of a sign-in lock. */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Sign-in (UX_ADMIN §2.10, website spec W01): the mobile number after a fixed "+92" (it has the focus
 * when the page opens) and the password, nothing prefilled. The server refuses every account that
 * isn't for this website (`AUTH_WRONG_APP`, `AUTH_ROLE_LOCKED`), and each refusal shows under the form
 * with no session started; a shop or driver account also gets "Use the Smart Fleet app on your phone."
 * A wrong password empties the password box and puts the focus back in it, keeping the number as typed.
 * Too many tries locks the button, counting down. A non-office role that still gets tokens (an older
 * API) is refused here too, so nobody who isn't office staff stays signed in. The page never changes
 * the address, so after signing in the person is back on the page that was open.
 */
export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { config } = useAppConfig();
  const env = resolveEnvKind(config.environment);
  useSignedOutTitle(t('signIn.documentTitle'), env);

  const form = useZodForm(loginSchema, { phone: '', password: '' });
  const passwordRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [notOffice, setNotOffice] = useState(false);
  const [wrongApp, setWrongApp] = useState(false);
  /** When the "too many tries" lock ends (epoch ms), or null. */
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const now = useNow(lockedUntil ? 1000 : 60_000);
  const lockLeft = lockedUntil ? lockedUntil - now : 0;
  const locked = lockLeft > 0;

  useEffect(() => {
    if (lockedUntil && !locked) setLockedUntil(null);
  }, [locked, lockedUntil]);

  const login = useApiMutation({
    mutationFn: (body: LoginInput) => api.post<LoginResponse>('/auth/login', body).then((response) => response.data),
  });

  /** Empties the password box (the number stays) and shows the refusal under the form. */
  const refuse = (error: unknown) => {
    form.reset({ phone: form.values.phone ?? '', password: '' });
    form.setServerError(error);
    passwordRef.current?.focus();
  };

  const submit = form.handleSubmit((body) => {
    if (locked) return;
    setNotOffice(false);
    setWrongApp(false);
    login.mutate(body, {
      onSuccess: (session) => {
        if (!isOfficeRole(session.role)) {
          form.reset({ phone: form.values.phone ?? '', password: '' });
          setNotOffice(true);
          return;
        }
        useAuthStore.getState().set({ token: session.accessToken, refreshToken: session.refreshToken, role: session.role });
      },
      onError: (error) => {
        const code = toApiError(error).code;
        if (code === 'RATE_LIMITED') {
          const minutes = errorDetails(error, 'RATE_LIMITED')?.minutes;
          if (typeof minutes === 'number' && minutes > 0) setLockedUntil(Date.now() + minutes * 60_000);
          form.setServerError(error);
          return;
        }
        if (code === 'AUTH_INVALID_CREDENTIALS' || code === 'AUTH_WRONG_APP' || code === 'AUTH_ROLE_LOCKED') {
          setWrongApp(code === 'AUTH_WRONG_APP');
          refuse(error);
          return;
        }
        form.setServerError(error);
      },
    });
  });

  const values = form.values;
  const phoneError = form.errorFor('phone') ? t('signIn.phoneRequired') : null;
  const passwordError = form.errorFor('password') ? t('signIn.passwordRequired') : null;
  const problem = notOffice ? t('signIn.notOffice') : form.formError;

  return (
    <div className="sf-signin">
      <EnvBadge kind={env} />
      <main className="sf-signin__main">
        <div className="sf-signin__panel">
          <SessionEndedNotice />
          <form className="sf-signin__card" onSubmit={submit} noValidate aria-labelledby="signin-title">
            <div className="sf-signin__brand" aria-hidden>
              <Cylinder size={24} strokeWidth={2} />
            </div>
            <h1 id="signin-title" className="sf-signin__title">
              {t('signIn.title')}
            </h1>

            <Field label={t('signIn.phone')} error={phoneError}>
              <PhoneInput
                name="phone"
                autoComplete="username"
                autoFocus
                value={values.phone ?? ''}
                // The box sends the number again when it loses focus: only a real change clears an error.
                onChange={(value) => {
                  if (value !== values.phone) form.setValue('phone', value);
                }}
                onBlur={() => form.touch('phone')}
              />
            </Field>

            <Field label={t('signIn.password')} error={passwordError}>
              <TextInput
                ref={passwordRef}
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={values.password ?? ''}
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
                {wrongApp && !notOffice ? <span className="sf-signin__error-hint">{t('signIn.wrongAppHint')}</span> : null}
              </InlineAlert>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={login.isPending}
              disabled={locked}
              className="sf-signin__submit"
            >
              {locked ? t('signIn.tryAgainIn', { time: clock(lockLeft) }) : t('signIn.submit')}
            </Button>
            <p className="sf-signin__forgot">{t('signIn.forgot')}</p>
          </form>
          <p className="sf-signin__footer">{t('signIn.footer')}</p>
        </div>
      </main>
    </div>
  );
}
