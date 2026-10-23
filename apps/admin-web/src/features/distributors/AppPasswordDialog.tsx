import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, WandSparkles } from 'lucide-react';
import { PASSWORD_MIN_LENGTH } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { messageFor } from '../../api/errors';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';
import { Button, CopyButton, Field, InlineAlert, Modal, SkeletonText, TextInput, useToast } from '../../ui';
import './distributors.css';

/** The longest password the API takes (API_CONTRACT §7.2: 8–128 characters, not trimmed). */
const PASSWORD_MAX_LENGTH = 128;
/** "Make one for me": 10 characters a person can read out on the phone (website spec W23). */
const MADE_LENGTH = 10;
/** No 0/O/o, 1/l/I: nothing that is misread when it is told by phone. */
const READABLE = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random password of readable characters, from the browser's secure random numbers. */
export function makePassword(length: number = MADE_LENGTH): string {
  const bytes = new Uint32Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => READABLE[byte % READABLE.length]).join('');
}

export interface AppPasswordDialogProps {
  /** The sign-in account (`users.id`); `undefined` while it is being found, `null` when there is none. */
  userId: string | null | undefined;
  /** The person's or distributor's name, for the title, the line and the toast. */
  name: string;
  onClose: () => void;
  /** After the password is set (the record's "App password · set" changes). */
  onDone?: () => void;
}

/**
 * "Set app password for {{name}}" (UX_ADMIN §2.4, website spec W23, API_CONTRACT §7.2
 * `POST /users/:id/password`), for a distributor or a driver: one password of at least 8 characters,
 * typed or made with "Make one for me" (10 readable characters, shown at once, with Copy), and told to
 * the person by phone. The password is sent once and never kept, logged or shown again: it lives only
 * in this dialog's state, which is dropped when it closes. The server checks the length too.
 */
export function AppPasswordDialog({ userId, name, onClose, onDone }: AppPasswordDialogProps) {
  const { t } = useTranslation(['distributors', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation({
    mutationFn: (body: { userId: string; password: string }) =>
      api.post<{ ok: true }>(`/users/${encodeURIComponent(body.userId)}/password`, { password: body.password }).then((r) => r.data),
  });

  const tooShort = password.length < PASSWORD_MIN_LENGTH;
  const finding = userId === undefined;
  const missing = userId === null;

  const makeOne = () => {
    setPassword(makePassword());
    setVisible(true);
    setPressed(false);
  };

  const confirm = () => {
    if (!userId || save.isPending) return;
    if (tooShort) {
      setPressed(true);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    save.mutate(
      { userId, password },
      {
        onSuccess: () => {
          setPassword('');
          toast.success(t('appPassword.toast', { name }));
          void queryClient.invalidateQueries({ queryKey: qk.distributors.all });
          void queryClient.invalidateQueries({ queryKey: qk.drivers.all });
          void queryClient.invalidateQueries({ queryKey: qk.activity.all });
          onDone?.();
          onClose();
        },
        onError: (failure) => setError(messageFor(failure)),
      },
    );
  };

  return (
    <Modal
      open
      size="sm"
      title={t('appPassword.title', { name })}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      dismissible={!save.isPending}
      initialFocusRef={goBackRef}
      footer={
        <>
          <Button ref={goBackRef} onClick={onClose} disabled={save.isPending}>
            {t('common:actions.goBack')}
          </Button>
          <Button variant="primary" icon={KeyRound} loading={save.isPending} disabled={finding || missing} onClick={confirm}>
            {t('appPassword.confirm')}
          </Button>
        </>
      }
    >
      <form
        className="sf-app-password"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        {finding ? <SkeletonText lines={1} /> : null}
        {missing ? (
          <InlineAlert tone="danger" live>
            {t('appPassword.notFound')}
          </InlineAlert>
        ) : null}
        <Field label={t('appPassword.label')} hint={t('appPassword.rule')} error={pressed && tooShort ? t('appPassword.tooShort') : null}>
          <TextInput
            ref={inputRef}
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            spellCheck={false}
            maxLength={PASSWORD_MAX_LENGTH}
            value={password}
            disabled={save.isPending || missing}
            className="sf-app-password__input"
            onChange={(event) => setPassword(event.target.value)}
            endAdornment={
              <button
                type="button"
                className="sf-app-password__reveal"
                aria-label={visible ? t('appPassword.hideLabel') : t('appPassword.showLabel')}
                aria-pressed={visible}
                onClick={() => setVisible((value) => !value)}
              >
                {visible ? t('appPassword.hide') : t('appPassword.show')}
              </button>
            }
          />
        </Field>
        <div className="sf-app-password__tools">
          <Button size="sm" variant="ghost" icon={WandSparkles} onClick={makeOne} disabled={save.isPending || missing}>
            {t('appPassword.generate')}
          </Button>
          {password ? <CopyButton iconOnly value={password} label={t('appPassword.copy')} /> : null}
        </div>
        <p className="sf-app-password__line">{t('appPassword.hint', { name })}</p>
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
      </form>
    </Modal>
  );
}
