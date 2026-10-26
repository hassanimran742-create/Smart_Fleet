import { useMemo, useState, type ReactNode } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, KeyRound, Pencil, Power } from 'lucide-react';
import type { DistributorDto, OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { qk } from '../../api/keys';
import { ButtonLink } from '../../app/ButtonLink';
import { formatPhone } from '../../i18n/format';
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
  Table,
  useConfirm,
  useHighlight,
  useToast,
  type TableColumn,
} from '../../ui';
import { whenText } from '../orders/format';
import { MoreMenu, type MoreMenuItem } from '../orders/MoreMenu';
import { approveDistributor, suspendDistributor, useDistributor, useInvalidateDistributor, useRecentOrders } from './api';
import { AppPasswordDialog } from './AppPasswordDialog';
import { ChangeCodeDialog, EditContactDialog, EditStoreDialog } from './DistributorDialogs';
import { PriceCoverage } from './DistributorsPage';
import { StoreThumbnail } from './LazyMaps';
import './distributors.css';

const route = getRouteApi('/distributors/$id');

type DialogKind = 'contact' | 'store' | 'code' | 'password';

function Card({
  title,
  action,
  children,
  className,
  highlighted = false,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  highlighted?: boolean;
}) {
  return (
    <section className={cx('sf-dist-card', highlighted && 'sf-highlight', className)} aria-label={title}>
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
      <Icon aria-hidden size={20} strokeWidth={2.25} className="sf-dist-check__icon" />
      <span className="sr-only">{done ? t('readiness.done') : t('readiness.notDone')}</span>
      <span className="sf-dist-check__text">{children}</span>
      {action ? <span className="sf-dist-check__action">{action}</span> : null}
    </li>
  );
}

type Readiness = NonNullable<DistributorDto['readiness']>;

function readinessOf(distributor: DistributorDto): Readiness {
  return (
    distributor.readiness ?? {
      storeSet: distributor.store !== null,
      pricesComplete: distributor.prices.total > 0 && distributor.prices.priced === distributor.prices.total,
      appPasswordSet: distributor.appPasswordSet,
    }
  );
}

/** The checklist of a distributor waiting to start (UX_ADMIN §2.4, website spec W20). */
function Checklist({
  distributor,
  onSetUpStore,
  onSetPassword,
}: {
  distributor: DistributorDto;
  onSetUpStore: () => void;
  onSetPassword: () => void;
}) {
  const { t } = useTranslation('distributors');
  const ready = readinessOf(distributor);
  return (
    <Card title={t('readiness.title', { name: distributor.businessName })} className="sf-dist-card--wide">
      <ul className="sf-dist-checks">
        <Check
          done={ready.storeSet}
          action={
            ready.storeSet ? null : (
              <Button size="sm" onClick={onSetUpStore}>
                {t('store.setUp')}
              </Button>
            )
          }
        >
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
              <Button size="sm" icon={KeyRound} onClick={onSetPassword}>
                {t('readiness.setPassword')}
              </Button>
            )
          }
        >
          {ready.appPasswordSet ? t('readiness.passwordSet') : t('readiness.passwordMissing')}
        </Check>
      </ul>
    </Card>
  );
}

/** The 5 newest orders as a small table (Order · Customer · Status · Placed); a row opens the order. */
function RecentOrders({ distributor }: { distributor: DistributorDto }) {
  const { t } = useTranslation('distributors');
  const navigate = route.useNavigate();
  const orders = useRecentOrders(distributor.id);
  const columns = useMemo<TableColumn<OrderDto>[]>(
    () => [
      { id: 'order', header: t('recent.columns.order'), cell: (order) => <span className="sf-record-no">{order.shortCode}</span> },
      { id: 'customer', header: t('recent.columns.customer'), cell: (order) => order.client.name },
      { id: 'status', header: t('recent.columns.status'), cell: (order) => <StatusChip kind="order" value={order.stage} /> },
      {
        id: 'placed',
        header: t('recent.columns.placed'),
        cell: (order) => (
          <time dateTime={order.createdAt} className="sf-dist__nowrap">
            {whenText(order.createdAt)}
          </time>
        ),
        priority: 2,
      },
    ],
    [t],
  );
  return (
    <Card
      title={t('recent.title')}
      className="sf-dist-card--wide sf-dist-card--table"
      action={
        <ButtonLink to="/orders" search={{ tab: 'all', distributor: distributor.id }} size="sm" variant="ghost">
          {t('recent.seeAll')}
        </ButtonLink>
      }
    >
      <Table<OrderDto>
        caption={t('recent.caption', { name: distributor.businessName })}
        columns={columns}
        rows={orders.data}
        rowKey={(order) => order.id}
        onRowClick={(order) =>
          void navigate({ to: '/orders/$orderId', params: { orderId: order.id }, search: { tab: 'all', distributor: distributor.id } })
        }
        chevron
        state={orders.isPending ? 'loading' : orders.isError && !orders.data ? 'error' : 'ready'}
        skeletonRows={3}
        empty={<p className="sf-dist-card__empty">{t('recent.empty')}</p>}
        error={
          <ErrorState
            compact
            error={orders.error}
            title={t('recent.loadFailed')}
            onRetry={() => void orders.refetch()}
            retrying={orders.isFetching}
          />
        }
      />
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

/** The distributor's name from the list on screen, for the title of a page that failed to load. */
function useCachedName(id: string): string | null {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const list = queryClient.getQueryData<DistributorDto[]>(qk.distributors.list());
    return list?.find((row) => row.id === id)?.businessName ?? null;
  }, [queryClient, id]);
}

/**
 * One distributor (`/distributors/$id`, UX_ADMIN §2.4, website spec W20).
 * - Waiting to start: the checklist ("Before Noor LPG can start": store, prices, app password, each with
 *   its button), Contact and Store; "Activate distributor" is the one primary and says why it is off.
 * - Active or suspended: Contact, Store, Wallet and Delivery prices as four cards of equal height, then
 *   the recent orders. "Set app password" is a visible button; More holds Change code (before the first
 *   order) and, after a divider, Suspend… or Reactivate… (each with a required "Why?").
 * Activity is collapsed at the end.
 */
export function DistributorPage() {
  const { t } = useTranslation(['distributors', 'common', 'nav']);
  const { id } = route.useParams();
  const query = useDistributor(id);
  const distributor = query.data;
  const cachedName = useCachedName(id);
  const confirm = useConfirm();
  const toast = useToast();
  const invalidate = useInvalidateDistributor(id);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [changed, highlight] = useHighlight();

  if (query.isPending) return <PageSkeleton />;
  if (!distributor) {
    return (
      <div className="sf-dist-page">
        <PageHeader title={cachedName ?? t('nav:pages.distributor')} />
        <ErrorState
          error={query.error}
          title={cachedName ? t('page.loadFailedFor', { name: cachedName }) : t('page.loadFailed')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </div>
    );
  }

  const name = distributor.businessName;
  const ready = readinessOf(distributor);
  const allReady = ready.storeSet && ready.pricesComplete && ready.appPasswordSet;
  const waiting = distributor.status === 'PENDING';

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
      points: [t('suspend.facts.signedOut'), t('suspend.facts.noNew'), t('suspend.facts.ordersContinue'), t('suspend.facts.balance')],
      tone: 'danger',
      confirmLabel: t('suspend.confirm', { name }),
      reason: { label: t('suspend.reason'), required: true, minLength: 5, maxLength: 300 },
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
      reason: { label: t('reactivate.reason'), required: true, minLength: 5, maxLength: 300 },
      action: ({ reason }) => approveDistributor(id, { reason }),
    });
    if (!ok) return;
    toast.success(t('reactivate.toast', { name }));
    await invalidate();
  };

  // More: the routine actions first, then a divider and the dangerous one, so the menu's focus never
  // starts on Suspend… (UX_ADMIN §2.4). While waiting, "Set app password" is the checklist's own button
  // until one is set; afterwards it is a visible header button.
  const moreItems: MoreMenuItem[] = [];
  if (!distributor.codeLocked) moreItems.push({ id: 'code', label: t('page.changeCode'), onSelect: () => setDialog('code') });
  if (waiting && ready.appPasswordSet) {
    moreItems.push({ id: 'password', label: t('page.setPassword'), onSelect: () => setDialog('password') });
  }
  const danger: MoreMenuItem =
    distributor.status === 'SUSPENDED'
      ? { id: 'reactivate', label: t('page.reactivate'), onSelect: () => void reactivate() }
      : { id: 'suspend', label: t('page.suspend'), danger: true, onSelect: () => void suspend() };
  moreItems.push({ ...danger, dividerBefore: moreItems.length > 0 });

  // A "More" never holds one item: a lone Suspend… or Reactivate… is its own button.
  const more =
    moreItems.length > 1 ? (
      <MoreMenu label={t('page.more')} ariaLabel={t('page.moreLabel', { name })} items={moreItems} />
    ) : (
      <Button variant={danger.danger ? 'ghost-danger' : 'secondary'} onClick={danger.onSelect}>
        {danger.label}
      </Button>
    );

  const store = distributor.store;
  const saved = (card: string) => () => {
    highlight(card);
    void invalidate();
  };

  const contactCard = (
    <Card
      title={t('contact.title')}
      highlighted={changed === 'contact'}
      action={
        <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('contact.editLabel')} onClick={() => setDialog('contact')}>
          {t('contact.edit')}
        </Button>
      }
    >
      <KeyValueList
        stacked
        items={[
          { id: 'name', label: t('contact.name'), value: distributor.contact.name },
          {
            id: 'phone',
            label: t('contact.phone'),
            value: <a href={`tel:${distributor.contact.phone}`}>{formatPhone(distributor.contact.phone)}</a>,
          },
          { id: 'email', label: t('contact.email'), value: distributor.contact.email ?? t('contact.noEmail') },
          { id: 'cnic', label: t('contact.cnic'), value: distributor.cnicMasked ?? t('contact.noCnic') },
        ]}
      />
    </Card>
  );

  const storeCard = (
    <Card
      title={t('store.title')}
      highlighted={changed === 'store'}
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
  );

  return (
    <div className="sf-dist-page">
      <PageHeader
        title={name}
        chip={<StatusChip kind="distributor" value={distributor.status} />}
        subtitle={t('page.subtitle', { code: distributor.code, phone: formatPhone(distributor.contact.phone) })}
        primaryAction={
          waiting ? (
            <Button
              variant="primary"
              icon={Power}
              disabled={!allReady}
              disabledReason={allReady ? undefined : t('page.activateBlocked')}
              reasonVisible
              onClick={() => void activate()}
            >
              {t('page.activate')}
            </Button>
          ) : null
        }
        secondaryActions={
          <>
            {waiting ? null : (
              <Button icon={KeyRound} onClick={() => setDialog('password')}>
                {t('page.setPassword')}
              </Button>
            )}
            {more}
          </>
        }
      />
      <StaleBanner query={query} />

      {waiting ? (
        <div className="sf-dist-grid sf-dist-grid--two">
          <Checklist distributor={distributor} onSetUpStore={() => setDialog('store')} onSetPassword={() => setDialog('password')} />
          {contactCard}
          {storeCard}
          <div className="sf-dist-card--wide">
            <ActivityList resourceType="distributor" resourceId={id} />
          </div>
        </div>
      ) : (
        <div className="sf-dist-grid sf-dist-grid--four">
          {contactCard}
          {storeCard}
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
            {distributor.prices.total === 0 ? (
              <p className="sf-dist__muted">{t('prices.noZones')}</p>
            ) : (
              <>
                <p className="sf-dist__figure">{t('prices.value', { priced: distributor.prices.priced, total: distributor.prices.total })}</p>
                <span>
                  <PriceCoverage prices={distributor.prices} />
                </span>
              </>
            )}
          </Card>
          <RecentOrders distributor={distributor} />
          <div className="sf-dist-card--wide">
            <ActivityList resourceType="distributor" resourceId={id} />
          </div>
        </div>
      )}

      {dialog === 'contact' ? (
        <EditContactDialog distributor={distributor} onClose={() => setDialog(null)} onSaved={saved('contact')} />
      ) : null}
      {dialog === 'store' ? <EditStoreDialog distributor={distributor} onClose={() => setDialog(null)} onSaved={saved('store')} /> : null}
      {dialog === 'code' ? <ChangeCodeDialog distributor={distributor} onClose={() => setDialog(null)} /> : null}
      {dialog === 'password' ? (
        <AppPasswordDialog userId={distributor.userId} name={name} onClose={() => setDialog(null)} onDone={() => void invalidate()} />
      ) : null}
    </div>
  );
}
