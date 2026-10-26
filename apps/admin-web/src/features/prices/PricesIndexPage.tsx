import { Navigate } from '@tanstack/react-router';
import { Plus, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { EmptyState, ErrorState, PageHeader, SkeletonText } from '../../ui';
import { useDistributorDirectory } from './api';
import { firstDistributor } from './example';
import './prices.css';

/**
 * `/prices` (UX_ADMIN §1.2): opens the first distributor's price grid, or says there are none yet.
 */
export function PricesIndexPage() {
  const { t } = useTranslation('prices');
  const directory = useDistributorDirectory();
  const first = directory.data ? firstDistributor(directory.data) : undefined;

  if (first) return <Navigate to="/prices/$distributorId" params={{ distributorId: first.id }} replace />;

  return (
    <div className="sf-prices">
      <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} />
      {directory.isPending ? (
        <SkeletonText lines={6} />
      ) : directory.isError ? (
        <ErrorState
          error={directory.error}
          onRetry={() => void directory.refetch()}
          retrying={directory.isFetching}
          title={t('index.loadFailed')}
        />
      ) : (
        <EmptyState
          icon={Store}
          title={t('index.emptyTitle')}
          action={
            <ButtonLink to="/distributors/new" variant="primary" icon={Plus}>
              {t('index.addDistributor')}
            </ButtonLink>
          }
        />
      )}
    </div>
  );
}
