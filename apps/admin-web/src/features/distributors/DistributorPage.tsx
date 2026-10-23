import { useState, type ReactNode } from 'react';
import { getRouteApi, Link } from '@tanstack/react-router';
import { CircleCheck, CircleX, Pencil, Power } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '../../app/ButtonLink';
import { SetAppPasswordDialog } from '../../components/PasswordResetButton';
import { useNow } from '../../hooks/useNow';
import { formatAgo, formatPhone, formatRs } from '../../i18n/format';
import {
  ActivityList,
  Button,
  cx,
  ErrorState,
  KeyValueList,
  MoneyText,
  PageHeader,
  Skeleton,
  SkeletonText,
  StaleBanner,
  StatusChip,
  useConfirm,
  useToast,
} from '../../ui';
import { MoreMenu, type MoreMenuItem } from '../orders/MoreMenu';
import {
  approveDistributor,
  suspendDistributor,
  useDistributor,
  useInvalidateDistributor,
  useRecentOrders,
} from './api';
import { ChangeCodeDialog, EditContactDialog, EditStoreDialog } from './DistributorDialogs';
import { StoreThumbnail } from './LazyMaps';
import './distributors.css';

const route = getRouteApi('/distributors/$id');

type DialogKind = 'contact' | 'store' | 'code' | 'password';

function Card({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('sf-dist-card', className)} aria-label={title}>
      <header className="sf-dist-card__header">
        <h2 className="sf-dist-card__title">{title}</h2>
        {action ? <div className="sf-dist-card__action">{action}</div> : null}
      </header>
      <div className="sf-dist-card__body">{children}</div>
    </section>
  );
}

function Check({ done, children, action }: { done: boolean; children: ReactNode; action?: ReactNode }) {
  const { t } = useTranslation('distributors');
  const Icon = done ? CircleCheck : CircleX;
  return (
    <li className={cx('sf-dist-check', done ? 'is-done' : 'is-missing')}>
      <Icon aria-hidden size={18} strokeWidth={2.25} className="sf-dist-check__icon" />
      <span className="sr-only">{done ? t('readiness.done') : t('readiness.notDone')}</span>
      <span className="sf-dist-check__text">{children}</span>
      {action ? <span className="sf-dist-check__action">{action}</span> : null}
    </li>
  );
}

/** The readiness checklist of a distributor waiting to start (UX_ADMIN §2.4). */
function Readiness({ distributor, onSetPassword }: { distributor: DistributorDto; onSetPassword: () => void }) {
  const { t } = useTranslation('distributors');
  const ready = distributor.readiness ?? {
    storeSet: distributor.store !== null,
    pricesComplete: distributor.prices.total > 0 && distributor.prices.priced === distributor.prices.total,
    appPasswordSet: distributor.appPasswordSet,
  };
  return (
    <Card title={t('readiness.title')} className="sf-dist-card--wide">
      <ul className="sf-dist-checks">
        <Check done={ready.storeSet}>
          {distributor.store ? t('readiness.storeSet', { zone: distributor.store.zone.name }) : t('readiness.storeMissing')}
        </Check>
        <Check
          done={ready.pricesComplete}
          action={
            ready.pricesComplete ? null : (
              <ButtonLink to="/prices/$distributorId" params={{ distributorId: distributor.id }} search={{ missing: true }} size="sm">
                {t('readiness.setPrices')}
              </ButtonLink>
            )
          }
        >
          {t('readiness.prices', { priced: distributor.prices.priced, total: distributor.prices.total })}
        </Check>
        <Check
          done={ready.appPasswordSet}
          action={
            ready.appPasswordSet ? null : (
              <Button size="sm" onClick={onSetPassword}>
                {t('page.setPassword')}
              </Button>
            )
          }
        >
          {t('readiness.password')}
        </Check>
      </ul>
      <p className="sf-dist__muted">{t('readiness.balance', { amount: formatRs(distributor.wallet.balancePaisa) })}</p>
    </Card>
  );
}

function RecentOrders({ distributorId }: { distributorId: string }) {
  const { t } = useTranslation('distributors');
  const now = useNow(60_000);
  const orders = useRecentOrders(distributorId);
  let body;
  if (orders.isPending) body = <SkeletonText lines={3} />;
  else if (orders.isError) {
    body = (
      <ErrorState
        compact
        error={orders.error}
        title={t('recent.loadFailed')}
        onRetry={() => void orders.refetch()}
        retrying={orders.isFetching}
      />
    );
  } else if (orders.data.length === 0) body = <p className="sf-dist__muted">{t('recent.empty')}</p>;
  else {
    body = (
      <ul className="sf-dist-orders">
        {orders.data.map((order) => (
          <li key={order.id} className="sf-dist-orders__row">
            <Link
              to="/orders/$orderId"
              params={{ orderId: order.id }}
              search={{ tab: 'all', distributor: distributorId }}
              className="sf-dist-orders__no"
            >
              {order.shortCode}
            </Link>
            <StatusChip kind="order" value={order.stage} />
            <span className="sf-dist-orders__customer">{order.client.name}</span>
            <time dateTime={order.createdAt} className="sf-dist__muted">
              {formatAgo(order.createdAt, now)}
            </time>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Card
      title={t('recent.title')}
      action={
        <ButtonLink to="/orders" search={{ tab: 'all', distributor: distributorId }} size="sm" variant="ghost">
          {t('recent.seeAll')}
        </ButtonLink>
      }
    >
      {body}
    </Card>
  );
}

function PageSkeleton() {
  return (
    <div className="sf-dist-page" aria-hidden>
      <div className="sf-dist-page__head">
        <Skeleton width="40%" height="1.6em" />
        <Skeleton width="20%" />
      </div>
      <div className="sf-dist-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sf-dist-card">
            <Skeleton width="35%" />
            <SkeletonText lines={3} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One distributor (`/distributors/$id`, UX_ADMIN §2.4): the readiness checklist while waiting to start,
 * then Contact, Store, Wallet, Delivery prices, Recent orders and Activity. "Activate distributor" is
 * the one primary (until the checklist passes it stays disabled and says why); More holds Suspend… or
 * Reactivate… (each with a required reason), Set app password and, before the first order, Change code.
 */
export function DistributorPage() {
  const { t } = useTranslation(['distributors', 'common']);
  const { id } = route.useParams();
  const query = useDistributor(id);
  const distributor = query.data;
  const confirm = useConfirm();
  const toast = useToast();
  const invalidate = useInvalidateDistributor(id);
  const [dialog, setDialog] = useState<DialogKind | null>(null);

  if (query.isPending) return <PageSkeleton />;
  if (!distributor) {
    return (
      <ErrorState
        error={query.error}
        title={t('page.loadFailed')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const name = distributor.businessName;
  const ready =
    distributor.readiness ??
    ({
      storeSet: distributor.store !== null,
      pricesComplete: distributor.prices.total > 0 && distributor.prices.priced === distributor.prices.total,
      appPasswordSet: distributor.appPasswordSet,
    } as const);
  const allReady = ready.storeSet && ready.pricesComplete && ready.appPasswordSet;

  const activate = async () => {
    const { ok } = await confirm({
      title: t('activate.title', { name }),
      body: t('activate.body'),
      confirmLabel: t('activate.confirm', { name }),
      action: () => approveDistributor(id, {}),
    });
    if (!ok) return;
    toast.success(t('activate.toast', { name }));
    await invalidate();
  };

  const suspend = async () => {
    const { ok } = await confirm({
      title: t('suspend.title', { name }),
      body: t('suspend.body'),
      tone: 'danger',
      confirmLabel: t('suspend.confirm', { name }),
      reason: { label: t('suspend.reason'), hint: t('suspend.reasonHint'), required: true, minLength: 5, maxLength: 300 },
      action: ({ reason }) => suspendDistributor(id, reason ?? ''),
    });
    if (!ok) return;
    toast.success(t('suspend.toast', { name }));
    await invalidate();
  };

  const reactivate = async () => {
    const { ok } = await confirm({
      title: t('reactivate.title', { name }),
      body: t('reactivate.body'),
      confirmLabel: t('reactivate.confirm', { name }),
      reason: { label: t('reactivate.reason'), hint: t('reactivate.reasonHint'), required: true, minLength: 5, maxLength: 300 },
      action: ({ reason }) => approveDistributor(id, { reason }),
    });
    if (!ok) return;
    toast.success(t('reactivate.toast', { name }));
    await invalidate();
  };

  const moreItems: MoreMenuItem[] = [];
  if (distributor.status === 'SUSPENDED') {
    moreItems.push({ id: 'reactivate', label: t('page.reactivate'), onSelect: () => void reactivate() });
  } else {
    moreItems.push({ id: 'suspend', label: t('page.suspend'), danger: true, onSelect: () => void suspend() });
  }
  moreItems.push({ id: 'password', label: t('page.setPassword'), onSelect: () => setDialog('password') });
  if (!distributor.codeLocked) moreItems.push({ id: 'code', label: t('page.changeCode'), onSelect: () => setDialog('code') });

  const store = distributor.store;
  const missingZones = Math.max(0, distributor.prices.total - distributor.prices.priced);

  return (
    <div className="sf-dist-page">
      <PageHeader
        title={name}
        chip={<StatusChip kind="distributor" value={distributor.status} />}
        meta={t('page.code', { code: distributor.code })}
        updatedAt={query.dataUpdatedAt || null}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        primaryAction={
          distributor.status === 'PENDING' ? (
            <Button
              variant="primary"
              icon={Power}
              disabled={!allReady}
              disabledReason={allReady ? undefined : t('page.activateBlocked')}
              onClick={() => void activate()}
            >
              {t('page.activate')}
            </Button>
          ) : null
        }
        secondaryActions={<MoreMenu label={t('page.more')} ariaLabel={t('page.moreLabel', { name })} items={moreItems} />}
      />
      <StaleBanner query={query} />

      <div className="sf-dist-grid">
        {distributor.status === 'PENDING' ? <Readiness distributor={distributor} onSetPassword={() => setDialog('password')} /> : null}

        <Card
          title={t('contact.title')}
          action={
            <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('contact.editLabel')} onClick={() => setDialog('contact')}>
              {t('contact.edit')}
            </Button>
          }
        >
          <KeyValueList
            items={[
              { id: 'name', label: t('contact.name'), value: distributor.contact.name },
              {
                id: 'phone',
                label: t('contact.phone'),
                value: <a href={`tel:${distributor.contact.phone}`}>{formatPhone(distributor.contact.phone)}</a>,
              },
              { id: 'email', label: t('contact.email'), value: distributor.contact.email ?? t('contact.noEmail') },
              {
                id: 'cnic',
                label: t('contact.cnic'),
                value: (
                  <span className="sf-dist__two-line">
                    {distributor.cnicMasked ? (
                      <span className="sf-dist__code">{distributor.cnicMasked}</span>
                    ) : (
                      <span>{t('contact.noCnic')}</span>
                    )}
                    {distributor.cnicMasked ? <span className="sf-dist__muted">{t('contact.cnicHint')}</span> : null}
                  </span>
                ),
              },
            ]}
          />
        </Card>

        <Card
          title={t('store.title')}
          action={
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setDialog('store')}>
              {store ? t('store.edit') : t('store.setUp')}
            </Button>
          }
        >
          {store ? (
            <>
              <StoreThumbnail lat={store.lat} lng={store.lng} label={t('store.mapLabel', { name: store.name })} />
              <p className="sf-dist__strong">{store.name}</p>
              <p>{store.address}</p>
              <p className="sf-dist__muted">{t('store.zone', { zone: store.zone.name })}</p>
            </>
          ) : (
            <p className="sf-dist__muted">{t('store.none')}</p>
          )}
        </Card>

        <Card
          title={t('wallet.title')}
          action={
            <ButtonLink to="/wallets/$distributorId" params={{ distributorId: id }} search={{}} size="sm" variant="ghost">
              {t('wallet.open')}
            </ButtonLink>
          }
        >
          <p className="sf-dist__muted">{t('wallet.balance')}</p>
          <MoneyText paisa={distributor.wallet.balancePaisa} size="xl" strong />
        </Card>

        <Card
          title={t('prices.title')}
          action={
            <ButtonLink to="/prices/$distributorId" params={{ distributorId: id }} search={{}} size="sm" variant="ghost">
              {t('prices.open')}
            </ButtonLink>
          }
        >
          <p className="sf-dist__figure">{t('prices.value', { priced: distributor.prices.priced, total: distributor.prices.total })}</p>
          <p className={cx(missingZones > 0 ? 'sf-dist__warning' : 'sf-dist__muted')}>
            {distributor.prices.total === 0
              ? t('prices.noZones')
              : missingZones > 0
                ? t('prices.missing', { count: missingZones })
                : t('prices.complete')}
          </p>
        </Card>

        <RecentOrders distributorId={id} />

        <section className="sf-dist-card sf-dist-card--wide">
          <ActivityList resourceType="distributor" resourceId={id} />
        </section>
      </div>

      {dialog === 'contact' ? <EditContactDialog distributor={distributor} onClose={() => setDialog(null)} /> : null}
      {dialog === 'store' ? <EditStoreDialog distributor={distributor} onClose={() => setDialog(null)} /> : null}
      {dialog === 'code' ? <ChangeCodeDialog distributor={distributor} onClose={() => setDialog(null)} /> : null}
      {dialog === 'password' ? (
        <SetAppPasswordDialog
          userId={distributor.userId}
          name={name}
          onClose={() => setDialog(null)}
          onDone={() => void invalidate()}
        />
      ) : null}
    </div>
  );
}
