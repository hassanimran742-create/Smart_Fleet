import { useMemo, useState, type RefObject } from 'react';
import type { DriverOfficeDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { formatDay } from '../../i18n/format';
import { EmptyState, ErrorState, Field, RadioCards, SearchField, SkeletonText, StatusChip, type RadioCardOption } from '../../ui';
import { useBusyDrivers, useDriverChoices } from './api';

/** With more drivers than this, the list shows "Find a driver" (website spec W29). */
const SEARCH_FROM = 7;

/**
 * Why a driver can't take this job, or null when they can (API_CONTRACT §7.6 rule 2, §7.11): the account
 * must be ACTIVE, availability AVAILABLE and a van set. Being offline or on another trip never blocks.
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

export interface DriverChoicesProps {
  /** The driver who has the job now (a change of driver): listed, but it can't be picked. */
  currentDriverId: string | null;
  /** The order being assigned: its own trip doesn't count as "on a trip". */
  orderId?: string;
  value: string | null;
  onChange: (driverId: string) => void;
  /** The main button was pressed with nobody picked: "Pick a driver." under the list. */
  showPickError: boolean;
  /** The list's container, so the dialog can move the focus to the first card. */
  listRef: RefObject<HTMLDivElement>;
}

/**
 * The driver cards of the assign dialogs (website spec W29), shared by orders and refills: each driver
 * is one card with one chip (On duty or Offline) and "· on a trip" when they have one; drivers who can't
 * take the job stay listed, greyed out, with the reason. "Find a driver" shows with more than 6 drivers.
 * No automatic option and no store picker (ADR-12).
 */
export function DriverChoices({ currentDriverId, orderId, value, onChange, showPickError, listRef }: DriverChoicesProps) {
  const { t } = useTranslation(['orders', 'common']);
  const drivers = useDriverChoices();
  const busy = useBusyDrivers();
  const [query, setQuery] = useState('');
  const total = drivers.data?.length ?? 0;
  const picked = drivers.data?.find((driver) => driver.id === value) ?? null;

  const options = useMemo<RadioCardOption[]>(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = (drivers.data ?? []).map((driver) => {
      const reason = unavailableReason(driver, currentDriverId);
      const onTrip = Array.from(busy.data?.get(driver.id) ?? []).some((id) => id !== orderId);
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
  }, [drivers.data, busy.data, t, currentDriverId, orderId, query]);

  if (drivers.isPending) return <SkeletonText lines={4} />;
  if (drivers.isError) {
    return (
      <ErrorState
        compact
        error={drivers.error}
        title={t('assign.driversFailed')}
        onRetry={() => void drivers.refetch()}
        retrying={drivers.isFetching}
      />
    );
  }
  if (total === 0) return <EmptyState compact title={t('assign.noDrivers.title')} body={t('assign.noDrivers.body')} />;

  return (
    <>
      {total >= SEARCH_FROM ? (
        <SearchField value={query} onChange={setQuery} placeholder={t('assign.search')} slashShortcut={false} debounceMs={0} />
      ) : null}
      <Field label={t('assign.driversLabel')} labelHidden error={showPickError && !picked ? t('assign.pickFirst') : null}>
        <div ref={listRef} className="sf-order-dialog__drivers">
          {options.length > 0 ? (
            <RadioCards options={options} value={value} onChange={onChange} />
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

/** The picked driver, from the same cached list the cards show. */
export function usePickedDriver(driverId: string | null): DriverOfficeDto | null {
  const drivers = useDriverChoices();
  return drivers.data?.find((driver) => driver.id === driverId) ?? null;
}
