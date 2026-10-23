import { useMemo, useRef, useState } from 'react';
import type { DriverOfficeDto, OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../../api/errors';
import i18n from '../../i18n';
import { formatDay } from '../../i18n/format';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  flashRow,
  InlineAlert,
  Modal,
  RadioCards,
  SearchField,
  SkeletonText,
  StatusChip,
  useToast,
  type RadioCardOption,
} from '../../ui';
import { useAssignDriver, useBusyDrivers, useDistributor, useDriverChoices, useInvalidateOrder } from './api';
import { cylindersText, storeText } from './format';

/** With more drivers than this, the dialog shows "Find a driver" (website spec W29). */
const SEARCH_FROM = 7;

/**
 * Why a driver can't take this order, or null when they can (API_CONTRACT §7.6 rule 2): the account must
 * be ACTIVE, availability AVAILABLE and a van set. Being offline or on another trip never blocks.
 */
export function unavailableReason(driver: DriverOfficeDto, currentDriverId: string | null): string | null {
  const t = i18n.t;
  if (driver.id === currentDriverId) return t('orders:assign.unavailable.current');
  if (driver.user.status === 'SUSPENDED') return t('orders:assign.unavailable.suspended');
  if (driver.user.status !== 'ACTIVE') return t('orders:assign.unavailable.notActive');
  if (driver.availability === 'ON_LEAVE') {
    return driver.leaveEnd
      ? t('orders:assign.unavailable.onLeaveUntil', { date: formatDay(driver.leaveEnd) })
      : t('orders:assign.unavailable.onLeave');
  }
  if (driver.availability === 'OFF_DUTY') return t('orders:assign.unavailable.offDuty');
  if (!driver.currentVehicle) return t('orders:assign.unavailable.noVan');
  return null;
}

/** The list order of website spec W29: on duty and free, on duty on a trip, offline, can't take it. */
function rank(driver: DriverOfficeDto, blocked: boolean, onTrip: boolean): number {
  if (blocked) return 3;
  if (!driver.isOnline) return 2;
  return onTrip ? 1 : 0;
}

export interface AssignDriverDialogProps {
  order: OrderDto;
  onClose: () => void;
  /** After a driver is assigned: the drawer closes too, so the office goes on to the next order. */
  onAssigned?: () => void;
}

/**
 * Assign a driver, or change the driver (UX_ADMIN §2.5, ADR-12, website spec W29): the trip always
 * starts at the distributor's own store, shown as one muted line. There is no store picker and no
 * automatic option. Each driver is one card with one chip (On duty or Offline) and "· on a trip" when
 * they have one; drivers who can't take the order stay listed, greyed out, with the reason. The main
 * button stays enabled: pressed with nobody picked, it says "Pick a driver.".
 */
export function AssignDriverDialog({ order, onClose, onAssigned }: AssignDriverDialogProps) {
  const { t } = useTranslation(['orders', 'common']);
  const toast = useToast();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const drivers = useDriverChoices();
  const busy = useBusyDrivers();
  const assign = useAssignDriver(order.id);
  const invalidate = useInvalidateOrder(order.id);
  // Orders placed before the pilot may carry no start store yet: the distributor's own store is it.
  const distributor = useDistributor(order.originStore ? null : order.distributor?.id);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changing = order.allowedActions.includes('REASSIGN') && order.trip !== null;
  const currentDriverId = changing ? (order.trip?.driver.id ?? null) : null;
  const startStore = order.originStore ?? distributor.data?.store ?? null;
  const storeLoading = !order.originStore && distributor.isPending && Boolean(order.distributor?.id);
  const total = drivers.data?.length ?? 0;

  const options = useMemo<RadioCardOption[]>(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = (drivers.data ?? []).map((driver) => {
      const reason = unavailableReason(driver, currentDriverId);
      const onTrip = Array.from(busy.data?.get(driver.id) ?? []).some((id) => id !== order.id);
      return { driver, reason, onTrip };
    });
    return rows
      .filter(({ driver }) => {
        if (words.length === 0) return true;
        const haystack = `${driver.user.name} ${driver.currentVehicle?.plateNo ?? ''}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .sort(
        (a, b) =>
          rank(a.driver, a.reason !== null, a.onTrip) - rank(b.driver, b.reason !== null, b.onTrip) ||
          a.driver.user.name.localeCompare(b.driver.user.name),
      )
      .map(({ driver, reason, onTrip }) => ({
        value: driver.id,
        label: driver.user.name,
        description: driver.currentVehicle
          ? onTrip
            ? t('assign.vanTrip', { plate: driver.currentVehicle.plateNo })
            : t('assign.van', { plate: driver.currentVehicle.plateNo })
          : t('assign.noVan'),
        meta: <StatusChip kind="presence" value={driver.isOnline ? 'ONLINE' : 'OFFLINE'} />,
        disabled: reason !== null,
        disabledReason: reason ?? undefined,
      }));
  }, [drivers.data, busy.data, t, currentDriverId, order.id, query]);

  const picked = drivers.data?.find((driver) => driver.id === driverId) ?? null;
  const blocked = !startStore && !storeLoading;

  const confirm = () => {
    if (blocked || assign.isPending) return;
    if (!picked) {
      setPressed(true);
      listRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:not(:disabled)')?.focus();
      return;
    }
    setError(null);
    assign.mutate(picked.id, {
      onSuccess: () => {
        toast.success(t('assign.toast', { no: order.shortCode, driver: picked.user.name }));
        flashRow('orders', order.id);
        void invalidate();
        onClose();
        onAssigned?.();
      },
      onError: (failure) => {
        setError(messageFor(failure));
        if (failure.is('ORDER_NOT_ASSIGNABLE', 'ASSIGN_ORDER_LOADED', 'NOT_FOUND')) void invalidate();
        if (failure.is('ASSIGN_DRIVER_NO_VEHICLE', 'ASSIGN_DRIVER_NOT_AVAILABLE')) void drivers.refetch();
      },
    });
  };

  let driverList;
  if (drivers.isPending) {
    driverList = <SkeletonText lines={4} />;
  } else if (drivers.isError) {
    driverList = (
      <ErrorState
        compact
        error={drivers.error}
        title={t('assign.driversFailed')}
        onRetry={() => void drivers.refetch()}
        retrying={drivers.isFetching}
      />
    );
  } else if (total === 0) {
    driverList = <EmptyState compact title={t('assign.noDrivers.title')} body={t('assign.noDrivers.body')} />;
  } else {
    driverList = (
      <>
        {total >= SEARCH_FROM ? (
          <SearchField value={query} onChange={setQuery} placeholder={t('assign.search')} slashShortcut={false} debounceMs={0} />
        ) : null}
        <Field label={t('assign.driversLabel')} labelHidden error={pressed && !picked ? t('assign.pickFirst') : null}>
          <div ref={listRef} className="sf-order-dialog__drivers">
            {options.length > 0 ? (
              <RadioCards options={options} value={driverId} onChange={setDriverId} />
            ) : (
              <p className="sf-order-dialog__note">{t('common:search.noMatches')}</p>
            )}
          </div>
        </Field>
        {picked && !picked.isOnline ? (
          <p className="sf-order-dialog__note">{t('assign.offlineNote', { driver: picked.user.name })}</p>
        ) : null}
      </>
    );
  }

  const confirmLabel = picked ? t('assign.confirm', { driver: picked.user.name }) : t('assign.confirmNone');

  return (
    <Modal
      open
      size="md"
      title={changing ? t('assign.titleChange', { no: order.shortCode }) : t('assign.title', { no: order.shortCode })}
      onClose={() => {
        if (!assign.isPending) onClose();
      }}
      dismissible={!assign.isPending}
      initialFocusRef={goBackRef}
      footer={
        <>
          <Button ref={goBackRef} onClick={onClose} disabled={assign.isPending}>
            {t('common:actions.goBack')}
          </Button>
          <Button
            variant="primary"
            loading={assign.isPending}
            disabled={blocked}
            disabledReason={blocked ? t('assign.noStoreTitle') : undefined}
            reasonVisible
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="sf-order-dialog">
        <div className="sf-order-dialog__lines">
          <p>
            {t('assign.summary', { customer: order.client.name, cylinders: cylindersText(order), zone: order.destZone.name })}
          </p>
          {storeLoading ? (
            <SkeletonText lines={1} />
          ) : startStore ? (
            <p>{t('assign.startsAt', { store: storeText(startStore) })}</p>
          ) : null}
        </div>
        {blocked ? (
          <InlineAlert tone="danger" title={t('assign.noStoreTitle')}>
            {t('assign.noStoreBody')}
          </InlineAlert>
        ) : null}
        {changing && order.trip ? (
          <InlineAlert tone="warning">{t('assign.changeWarning', { driver: order.trip.driver.name })}</InlineAlert>
        ) : null}
        {driverList}
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
      </div>
    </Modal>
  );
}
