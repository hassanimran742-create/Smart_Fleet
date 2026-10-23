import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { PASSWORD_MIN_LENGTH } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { qk } from '../api/keys';
import { useApiMutation } from '../api/useApiMutation';
import { Button, Field, IconButton, InlineAlert, Modal, SkeletonText, TextInput, useToast } from '../ui';
import '../features/distributors/distributors.css';

/** The longest password the API takes (API_CONTRACT §7.2: 8–128 characters, not trimmed). */
const PASSWORD_MAX_LENGTH = 128;

export interface SetAppPasswordDialogProps {
  /** The sign-in account (`users.id`); `undefined` while it is being found, `null` when there is none. */
  userId: string | null | undefined;
  /** The person's or shop's name, for the title, the helper and the toast. */
  name: string;
  onClose: () => void;
  /** After the password is set (the record's "App password set" changes). */
  onDone?: () => void;
}

/**
 * "Set app password for {{name}}" (UX_ADMIN §2.4, API_CONTRACT §7.2 `POST /users/:id/password`): one
 * password field of at least 8 characters with Show/Hide, typed by the office and told to the person by
 * phone or in person. The typed password is sent once and never kept, logged or shown again: it lives
 * only in this dialog's state, which is dropped when it closes.
 */
export function SetAppPasswordDialog({ userId, name, onClose, onDone }: SetAppPasswordDialogProps) {
  const { t } = useTranslation(['distributors', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation({
    mutationFn: (body: { userId: string; password: string }) =>
      api.post<{ ok: true }>(`/users/${encodeURIComponent(body.userId)}/password`, { password: body.password }).then((r) => r.data),
  });

  const tooShort = password.length < PASSWORD_MIN_LENGTH;
  const finding = userId === undefined;
  const missing = userId === null;

  const confirm = () => {
    setTouched(true);
    if (tooShort || !userId || save.isPending) return;
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
          <Button
            variant="primary"
            icon={KeyRound}
            loading={save.isPending}
            disabled={finding || missing}
            onClick={confirm}
          >
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
        <Field
          label={t('appPassword.label')}
          hint={t('appPassword.hint', { name })}
          error={touched && tooShort ? t('appPassword.tooShort') : null}
        >
          <TextInput
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            spellCheck={false}
            maxLength={PASSWORD_MAX_LENGTH}
            value={password}
            disabled={save.isPending || missing}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setTouched(true)}
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
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
      </form>
    </Modal>
  );
}

interface Props {
  userId: string;
  userName?: string | null;
  /** `icon` for a table row (the legacy Drivers screen); `button` shows the words too. */
  variant?: 'icon' | 'button';
  /** After a successful set. */
  onDone?: () => void;
}

/**
 * The office's "Set app password" action for a distributor or driver login (UX_ADMIN §2.4), as a
 * button with a key icon that opens {@link SetAppPasswordDialog}.
 */
export function PasswordResetButton({ userId, userName, variant = 'icon', onDone }: Props) {
  const { t } = useTranslation('distributors');
  const [open, setOpen] = useState(false);
  const name = userName ?? '';
  return (
    <>
      {variant === 'icon' ? (
        <IconButton icon={KeyRound} label={t('appPassword.buttonLabel', { name })} onClick={() => setOpen(true)} />
      ) : (
        <Button icon={KeyRound} onClick={() => setOpen(true)}>
          {t('appPassword.button')}
        </Button>
      )}
      {open ? <SetAppPasswordDialog userId={userId} name={name} onClose={() => setOpen(false)} onDone={onDone} /> : null}
    </>
  );
}
