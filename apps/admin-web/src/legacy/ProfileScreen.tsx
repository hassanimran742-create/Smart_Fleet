import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginResponse } from '@smartfleet/shared-types';
import { PASSWORD_MIN_LENGTH } from '@smartfleet/shared-validation';
import { api } from '../api/client';
import { messageFor, toApiError } from '../api/errors';
import { translateDynamic } from '../i18n';
import { formatPhone } from '../i18n/format';
import { useAuthStore } from '../store/auth';
import { Button, ErrorState, Field, InlineAlert, PageHeader, SkeletonText, TextInput, ToggleChip, useToast } from '../ui';
import { useLegacyT } from './i18n';
import './legacy.css';

/**
 * The office user's own profile and password ("My profile"), kept inside the shell for Inc 1 (UX_ADMIN
 * §1.2). Light pass (website spec W49): two cards, one form each; their buttons stay enabled and say
 * what is missing; one "Show passwords" chip for the three boxes; the tech team, never "engineering".
 * The API rules stay (API_CONTRACT §7.1, §7.2):
 * - `PATCH /users/me` changes only the name and email; the sign-in phone is shown, not edited, and no
 *   CNIC is shown at all;
 * - `POST /auth/change-password` ends every other session and returns new tokens, which this screen
 *   keeps, so the person stays signed in here.
 */
interface Me {
  name: string | null;
  phone: string;
  email: string | null;
}

export function ProfileScreen() {
  const lt = useLegacyT();
  const role = useAuthStore((s) => s.role);
  const roleWords = (role && translateDynamic(`common:roleName.${role}`)) || '';
  const me = useQuery({ queryKey: ['me'], queryFn: async () => (await api.get<Me>('/users/me')).data });

  return (
    <div className="sf-legacy-page">
      <PageHeader title={lt('profile.title')} subtitle={roleWords ? lt('profile.signedInAs', { role: roleWords }) : undefined} />
      <div className="sf-legacy-cards">
        {me.isPending ? (
          <section className="sf-legacy-card">
            <SkeletonText lines={4} />
          </section>
        ) : me.isError || !me.data ? (
          <section className="sf-legacy-card">
            <ErrorState compact error={me.error} title={lt('profile.loadFailed')} onRetry={() => void me.refetch()} retrying={me.isFetching} />
          </section>
        ) : (
          <ProfileCard me={me.data} />
        )}
        <PasswordCard />
      </div>
    </div>
  );
}

function ProfileCard({ me }: { me: Me }) {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me.name ?? '');
  const [email, setEmail] = useState(me.email ?? '');
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(me.name ?? '');
    setEmail(me.email ?? '');
  }, [me.name, me.email]);

  const save = useMutation({
    mutationFn: () => api.patch('/users/me', { name: name.trim(), email: email.trim() || null }).then((r) => r.data),
    onSuccess: () => {
      setError(null);
      toast.success(lt('profile.savedToast'));
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => setError(messageFor(e)),
  });

  const submit = () => {
    if (save.isPending) return;
    if (!name.trim()) {
      setPressed(true);
      return;
    }
    if (name.trim() === (me.name ?? '') && email.trim() === (me.email ?? '')) return;
    save.mutate();
  };

  return (
    <section className="sf-legacy-card" aria-labelledby="profile-card">
      <h2 id="profile-card" className="sf-legacy-card__title">
        {lt('profile.profile')}
      </h2>
      <form
        className="sf-legacy-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={lt('profile.name')} error={pressed && !name.trim() ? lt('profile.nameMissing') : null}>
          <TextInput value={name} autoComplete="name" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={lt('profile.email')} optional>
          <TextInput type="email" value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <div className="sf-legacy-form__fact">
          <span className="sf-field__label">{lt('profile.phone')}</span>
          <span className="sf-legacy__strong">{formatPhone(me.phone)}</span>
          <span className="sf-legacy__muted">{lt('profile.phoneHint')}</span>
        </div>
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
        <div>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {lt('profile.save')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function PasswordCard() {
  const lt = useLegacyT();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongCurrent, setWrongCurrent] = useState(false);

  const change = useMutation({
    mutationFn: () => api.post<LoginResponse>('/auth/change-password', { currentPassword: current, newPassword: next }).then((r) => r.data),
    onSuccess: (session) => {
      // The change ends every other session; keep this one going with the new tokens.
      useAuthStore.getState().setTokens({ token: session.accessToken, refreshToken: session.refreshToken, role: session.role });
      setError(null);
      setPressed(false);
      setCurrent('');
      setNext('');
      setAgain('');
      toast.success(lt('profile.passwordToast'));
    },
    onError: (e) => {
      const wrong = toApiError(e).fields.some((field) => field.path === 'currentPassword');
      setWrongCurrent(wrong);
      setError(wrong ? null : messageFor(e));
    },
  });

  const currentError = !current ? lt('profile.currentMissing') : wrongCurrent ? lt('profile.currentWrong') : null;
  const nextError = next.length < PASSWORD_MIN_LENGTH ? lt('profile.tooShort') : null;
  const againError = next !== again ? lt('profile.mismatch') : null;

  const submit = () => {
    if (change.isPending) return;
    if (!current || nextError || againError) {
      setPressed(true);
      return;
    }
    setError(null);
    setWrongCurrent(false);
    change.mutate();
  };

  const type = show ? 'text' : 'password';
  return (
    <section className="sf-legacy-card" aria-labelledby="password-card">
      <h2 id="password-card" className="sf-legacy-card__title">
        {lt('profile.changePassword')}
      </h2>
      <p className="sf-legacy__muted">{lt('profile.passwordHint')}</p>
      <form
        className="sf-legacy-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={lt('profile.current')} error={pressed || wrongCurrent ? currentError : null}>
          <TextInput
            type={type}
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setWrongCurrent(false);
              setCurrent(event.target.value);
            }}
          />
        </Field>
        <Field label={lt('profile.new')} hint={lt('profile.rule')} error={pressed ? nextError : null}>
          <TextInput type={type} autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
        </Field>
        <Field label={lt('profile.again')} error={pressed || (again.length > 0 && again.length >= next.length) ? againError : null}>
          <TextInput type={type} autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
        </Field>
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
        <div className="sf-legacy-form__actions">
          <ToggleChip label={lt('profile.showPasswords')} pressed={show} onChange={setShow} />
          <Button type="submit" loading={change.isPending}>
            {lt('profile.changePassword')}
          </Button>
        </div>
      </form>
    </section>
  );
}
