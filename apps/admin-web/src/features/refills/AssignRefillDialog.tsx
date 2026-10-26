import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../../api/errors';
import { Button, flashRow, InlineAlert, Modal, useToast } from '../../ui';
import { useDriverChoices } from '../orders/api';
import { DriverChoices, usePickedDriver } from '../orders/DriverChoices';
import { invalidateRefills, useAssignRefill, type RefillRow } from './api';
import { refillCylinders } from './format';
// The dialog's layout is the orders dialog's (`sf-order-dialog`).
import '../orders/orders.css';

export interface AssignRefillDialogProps {
  refill: RefillRow;
  onClose: () => void;
  /** After a driver is assigned: the drawer closes too, so the office goes on to the next refill. */
  onAssigned?: () => void;
}

/**
 * Assign a driver to a refill (UX_ADMIN §4.1): the orders dialog's driver cards and button (website spec
 * W29), with the refill's own summary. It acts at once with a toast (rulebook rule 7: the dialog is the
 * choice), and the row moves to In progress. No money (ADR-16).
 */
export function AssignRefillDialog({ refill, onClose, onAssigned }: AssignRefillDialogProps) {
  const { t } = useTranslation(['refills', 'orders', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const goBackRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const drivers = useDriverChoices();
  const assign = useAssignRefill(refill.id);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = usePickedDriver(driverId);
  const no = refill.shortCode ?? null;

  const confirm = () => {
    if (assign.isPending) return;
    if (!picked) {
      setPressed(true);
      listRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:not(:disabled)')?.focus();
      return;
    }
    setError(null);
    assign.mutate(picked.id, {
      onSuccess: () => {
        toast.success(
          no ? t('assignDialog.toast', { no, driver: picked.user.name }) : t('assignDialog.toastNoNumber', { driver: picked.user.name }),
        );
        flashRow('refills', refill.id);
        void invalidateRefills(queryClient, refill.id);
        onClose();
        onAssigned?.();
      },
      onError: (failure) => {
        setError(messageFor(failure));
        if (failure.is('REFILL_WRONG_STEP', 'NOT_FOUND')) void invalidateRefills(queryClient, refill.id);
        if (failure.is('ASSIGN_DRIVER_NO_VEHICLE', 'ASSIGN_DRIVER_NOT_AVAILABLE')) void drivers.refetch();
      },
    });
  };

  const station = refill.fillingStation?.name;
  const summary = station
    ? t('assignDialog.summary', { distributor: refill.distributor.businessName, cylinders: refillCylinders(refill), station })
    : t('assignDialog.summaryNoStation', { distributor: refill.distributor.businessName, cylinders: refillCylinders(refill) });

  return (
    <Modal
      open
      size="md"
      title={no ? t('assignDialog.title', { no }) : t('assignDialog.titleNoNumber')}
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
          <Button variant="primary" loading={assign.isPending} onClick={confirm}>
            {picked ? t('orders:assign.confirm', { driver: picked.user.name }) : t('orders:assign.confirmNone')}
          </Button>
        </>
      }
    >
      <div className="sf-order-dialog">
        <div className="sf-order-dialog__lines">
          <p>{summary}</p>
          {refill.pickupStore ? <p>{t('assignDialog.pickupAt', { store: refill.pickupStore.name })}</p> : null}
        </div>
        <DriverChoices
          currentDriverId={refill.assignedDriver?.id ?? null}
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
