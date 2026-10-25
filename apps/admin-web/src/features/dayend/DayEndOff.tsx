import { PowerOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { EmptyState } from '../../ui';

/**
 * While day-end is switched off (`dayEnd.enabled`, every day-end route then answers 403
 * FEATURE_DISABLED): "Day-end is switched off" with "Open settings", the words every switched-off
 * feature uses (UX_ADMIN §1.2).
 */
export function DayEndOff() {
  const { t } = useTranslation(['dayend', 'common']);
  return (
    <EmptyState
      icon={PowerOff}
      title={t('common:moduleOff.title', { module: t('title') })}
      body={t('common:moduleOff.body')}
      action={
        <ButtonLink to="/settings" search={{ section: 'modules' }}>
          {t('common:actions.openSettings')}
        </ButtonLink>
      }
    />
  );
}
