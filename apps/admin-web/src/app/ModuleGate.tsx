import type { ReactNode } from 'react';
import { PowerOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonText } from '../ui/Skeleton';
import { ButtonLink } from './ButtonLink';
import { MODULES, useModule, type ModuleId } from './modules';

/** "{{module}} is switched off" with "Open settings" (UX_ADMIN §1.2). */
export function ModuleOff({ module }: { module: ModuleId }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={PowerOff}
      title={t('moduleOff.title', { module: t(MODULES[module].labelKey) })}
      body={t('moduleOff.body')}
      action={
        <ButtonLink to="/settings" search={{ section: 'modules' }}>
          {t('actions.openSettings')}
        </ButtonLink>
      }
    />
  );
}

/** Renders `children` only while the module is on; its route shows {@link ModuleOff} otherwise. */
export function ModuleGate({ module, children }: { module: ModuleId; children: ReactNode }) {
  const { enabled, loading } = useModule(module);
  if (loading) return <SkeletonText lines={4} />;
  if (!enabled) return <ModuleOff module={module} />;
  return <>{children}</>;
}
