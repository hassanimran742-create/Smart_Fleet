import { LogOut, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { signOut } from '../api/client';
import { useAuthStore, type SignOutReason } from '../store/auth';
import { Button } from '../ui/Button';
import { InlineAlert } from '../ui/InlineAlert';

/**
 * The full page a signed-in non-office account sees (UX_ADMIN §2.10, website spec W02): "This website
 * is for office staff" / "Drivers and distributors use the Smart Fleet app on their phone." with one
 * primary button, Sign out. The auth lane may restyle it in `features/auth`; RequireStaff renders
 * whatever that folder exports as `RoleGatePage`.
 */
export function DefaultRoleGatePage() {
  const { t } = useTranslation();
  return (
    <main className="sf-gate">
      <div className="sf-gate__card">
        <Smartphone aria-hidden className="sf-gate__icon" size={36} strokeWidth={1.75} />
        <p className="sf-gate__product">{t('appName')}</p>
        <h1 className="sf-gate__title">{t('roleGate.title')}</h1>
        <p className="sf-gate__body">{t('roleGate.body')}</p>
        <Button variant="primary" icon={LogOut} onClick={signOut}>
          {t('actions.signOut')}
        </Button>
      </div>
    </main>
  );
}

const REASON_KEYS = {
  idle: 'session.idleSignedOut',
  'session-ended': 'session.ended',
} as const satisfies Partial<Record<SignOutReason, string>>;

/**
 * Why the person was signed out, for the top of the sign-in page (UX_ADMIN §1.7, §2.10): "You were
 * signed out after 30 minutes without activity." or "Your session ended. Sign in again."
 */
export function SessionEndedNotice() {
  const { t } = useTranslation();
  const reason = useAuthStore((s) => s.signedOutReason);
  if (reason !== 'idle' && reason !== 'session-ended') return null;
  return (
    <InlineAlert tone={reason === 'idle' ? 'info' : 'warning'} live className="sf-session-notice">
      {t(REASON_KEYS[reason])}
    </InlineAlert>
  );
}
