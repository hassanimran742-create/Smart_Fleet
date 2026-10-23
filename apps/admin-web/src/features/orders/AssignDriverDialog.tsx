import { useMemo, useRef, useState } from 'react';
import { Store } from 'lucide-react';
import type { DriverOfficeDto, OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../../api/errors';
import i18n from '../../i18n';
import { formatDay } from '../../i18n/format';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  InlineAlert,
  Modal,
  RadioCards,
  SkeletonText,
  StatusChip,
  useToast,
  type RadioCardOption,
} from '../../ui';
import { useAssignDriver, useBusyDrivers, useDistributor, useDriverChoices, useInvalidateOrder } from './api';
import { cylindersText, storeText } from './format';

/**
 * Why a driver can't take this job, or null when they can (API_CONTRACT §7.6 rule 2): the account must
 * be ACTIVE, availability AVAILABLE and a van set. Being offline or on another run never blocks.
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

export interface AssignDriverDialogProps {
  order: OrderDto;
  onClose: () => void;
}

/**
 * Assign a driver, or change the driver (UX_ADMIN §2.5, ADR-12): the trip always starts at the
 * distributor's own store, shown as plain text. There is no store picker and no automatic option.
 * Drivers who can't take the job stay listed, greyed out, with the reason.
 */
export function AssignDriverDialog({ order, onClose }: AssignDriverDialogProps) {
  const { t } = useTranslation(['orders', 'common']);
  const toast = useToast();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const drivers = useDriverChoices();
  const busy = useBusyDrivers();
  const assign = useAssignDriver(order.id);
  const invalidate = useInvalidateOrder(order.id);
  // Orders placed before the pilot may carry no start store yet: the distributor's own store is it.
  const distributor = useDistributor(order.originStore ? null : order.distributor?.id);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changing = order.allowedActions.includes('REASSIGN') && order.trip !== null;
  const currentDriverId = changing ? (order.trip?.driver.id ?? null) : null;
  const startStore = order.originStore ?? distributor.data?.store ?? null;
  const storeLoading = !order.originStore && distributor.isPending && Boolean(order.distributor?.id);

  const options = useMemo<RadioCardOption[]>(() => {
    const list = [...(drivers.data ?? [])].sort((a, b) => {
      const ra = unavailableReason(a, currentDriverId) === null ? 0 : 1;
      const rb = unavailableReason(b, currentDriverId) === null ? 0 : 1;
      return ra - rb || a.user.name.localeCompare(b.user.name);
    });
    return list.map((driver) => {
      const reason = unavailableReason(driver, currentDriverId);
      const otherRun = Array.from(busy.data?.get(driver.id) ?? []).some((id) => id !== order.id);
      return {
        value: driver.id,
        label: driver.user.name,
        description: driver.currentVehicle ? t('assign.van', { plate: driver.currentVehicle.plateNo }) : t('assign.noVan'),
        meta: (
          <span className="sf-order-dialog__meta">
            <StatusChip kind="presence" value={driver.isOnline ? 'ONLINE' : 'OFFLINE'} />
            {otherRun ? <Chip tone="info">{t('assign.anotherRun')}</Chip> : null}
          </span>
        ),
        disabled: reason !== null,
        disabledReason: reason ?? undefined,
      };
    });
  }, [drivers.data, busy.data, t, currentDriverId, order.id]);

  const picked = drivers.data?.find((driver) => driver.id === driverId) ?? null;
  const blocked = !startStore && !storeLoading;

  const confirm = () => {
    if (!picked || blocked || assign.isPending) return;
    setError(null);
    assign.mutate(picked.id, {
      onSuccess: () => {
        toast.success(t('assign.toast', { no: order.shortCode, driver: picked.user.name }));
        void invalidate();
        onClose();
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
  } else if (options.length === 0) {
    driverList = <EmptyState compact title={t('assign.noDrivers.title')} body={t('assign.noDrivers.body')} />;
  } else {
    driverList = (
      <Field label={t('assign.driversLabel')}>
        <div className="sf-order-dialog__drivers">
          <RadioCards options={options} value={driverId} onChange={setDriverId} />
        </div>
      </Field>
    );
  }

  const confirmLabel = picked ? t('assign.confirm', { driver: picked.user.name }) : t('assign.confirmNone');

  return (
    <Modal
      open
      size="md"
      title={changing ? t('assign.titleChange', { no: order.shortCode }) : t('assign.title', { no: order.shortCode })}
      description={t('assign.summary', {
        customer: order.client.name,
        cylinders: cylindersText(order),
        zone: order.destZone.name,
      })}
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
            disabled={!picked || blocked}
            disabledReason={blocked ? t('assign.noStoreTitle') : !picked ? t('assign.pickFirst') : undefined}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="sf-order-dialog">
        {storeLoading ? (
          <SkeletonText lines={1} />
        ) : startStore ? (
          <p className="sf-order-dialog__start">
            <Store aria-hidden size={16} strokeWidth={2} />
            <span>{t('assign.startsAt', { store: storeText(startStore) })}</span>
            <span className="sf-order-dialog__start-hint">{t('assign.startsAtHint')}</span>
          </p>
        ) : (
          <InlineAlert tone="danger" title={t('assign.noStoreTitle')}>
            {t('assign.noStoreBody')}
          </InlineAlert>
        )}
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
