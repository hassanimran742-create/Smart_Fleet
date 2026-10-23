import { useTranslation } from 'react-i18next';
import { resolveEnvKind } from '../../app/env';
import { DefaultRoleGatePage } from '../../app/RoleGate';
import { useAppConfig } from '../../hooks/useAppConfig';
import { useSignedOutTitle } from './LoginPage';

/**
 * The full page a saved session of any role but SUPER_ADMIN sees (UX_ADMIN §2.10): "This website is
 * for office staff. Drivers and distributors use the Smart Fleet app." with Sign out. It is only a
 * fallback: the server refuses those accounts at sign-in (`AUTH_WRONG_APP`, `AUTH_ROLE_LOCKED`).
 */
export function RoleGatePage() {
  const { t } = useTranslation('auth');
  const { config } = useAppConfig();
  useSignedOutTitle(t('roleGate.documentTitle'), resolveEnvKind(config.environment));
  return <DefaultRoleGatePage />;
}
