import { useRef, useState } from 'react';
import type { OrderDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../../api/errors';
import { Button, flashRow, InlineAlert, Modal, SkeletonText, useToast } from '../../ui';
import { useAssignDriver, useDistributor, useDriverChoices, useInvalidateOrder } from './api';
import { DriverChoices, usePickedDriver } from './DriverChoices';
import { cylindersText, storeText } from './format';

export { unavailableReason } from './DriverChoices';

export interface AssignDriverDialogProps {
  order: OrderDto;
  onClose: () => void;
  /** After a driver is assigned: the drawer closes too, so the office goes on to the next order. */
  onAssigned?: () => void;
}

/**
 * Assign a driver, or change the driver (UX_ADMIN §2.5, ADR-12, website spec W29): the trip always
 * starts at the distributor's own store, shown as one muted line. There is no store picker and no
 * automatic option. The driver cards are `DriverChoices`, which the refill dialog shares. The main
 * button stays enabled: pressed with nobody picked, it says "Pick a driver.".
 */
export function AssignDriverDialog({ order, onClose, onAssigned }: AssignDriverDialogProps) {
  const { t } = useTranslation(['orders', 'common']);
  const toast = useToast();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const drivers = useDriverChoices();
  const assign = useAssignDriver(order.id);
  const invalidate = useInvalidateOrder(order.id);
  // Orders placed before the pilot may carry no start store yet: the distributor's own store is it.
  const distributor = useDistributor(order.originStore ? null : order.distributor?.id);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = usePickedDriver(driverId);

  const changing = order.allowedActions.includes('REASSIGN') && order.trip !== null;
  const currentDriverId = changing ? (order.trip?.driver.id ?? null) : null;
  const startStore = order.originStore ?? distributor.data?.store ?? null;
  const storeLoading = !order.originStore && distributor.isPending && Boolean(order.distributor?.id);
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
        <DriverChoices
          currentDriverId={currentDriverId}
          orderId={order.id}
          value={driverId}
          onChange={setDriverId}
          showPickError={pressed}
          listRef={listRef}
        />
        {error ? (
          <InlineAlert tone="danger" live>
            {error}
          </InlineAlert>
        ) : null}
      </div>
    </Modal>
  );
}
