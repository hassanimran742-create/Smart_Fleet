import { useEffect } from 'react';
import { RotateCw, SearchX } from 'lucide-react';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { ButtonLink } from './ButtonLink';

/**
 * An address that isn't a page (an old bookmark, a typo): one message and the way back to Today. There
 * is no page header, which would only repeat it; "Page not found" stays in the browser tab's title.
 */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={SearchX}
      title={t('notFound.title')}
      body={t('notFound.body')}
      action={
        <ButtonLink to="/today" variant="primary">
          {t('actions.goToToday')}
        </ButtonLink>
      }
    />
  );
}

/**
 * A page that crashed while rendering, or whose code couldn't be loaded (often a new release: reloading
 * fetches it). The rest of the shell keeps working.
 */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);
  return (
    <div className="sf-route-error">
      <ErrorState error={error} title={t('routeError.title')} onRetry={reset} />
      <p className="sf-route-error__hint">{t('routeError.body')}</p>
      <Button icon={RotateCw} variant="ghost" onClick={() => window.location.reload()}>
        {t('actions.reloadPage')}
      </Button>
    </div>
  );
}
