import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { toApiError } from '../../api/errors';
import { driver as driverEnglish } from '../../i18n/en/driver';
import type { DriverStackParams } from '../../navigation/DriverStack';
import { ConfirmSheet, motion, useToast, type ConfirmInput, type ConfirmReason } from '../../ui';
import { finishTrip, refreshAfterFinish } from './tripApi';

/** Why cylinders stay on the van (driver spec R3; DECIDED: picked by tap). */
const LEFTOVER_REASONS = ['STORE_CLOSED', 'NO_ONE', 'OTHER'] as const;
type LeftoverReason = (typeof LEFTOVER_REASONS)[number];

/** The server's rule for a leftover reason: 5–300 characters (API_CONTRACT §9.3). */
const LEFTOVER_NOTE_MIN = 5;

/** The second sheet opens once the first has slid away: never a sheet on top of a sheet (rulebook §7.4). */
const SHEET_SWAP_MS = motion.sheet + 80;

export interface FinishTripSheetProps {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  /** The store's name, for "Unload at {{store}} first." */
  store: string;
}

/**
 * "Finish this trip?" (driver spec D6; kept by rule 7). On success: Today, with the "Trip done" toast.
 * A refusal shows on the sheet's line ("Finish or close every order on this trip first.").
 *
 * When the office allows finishing with cylinders still on the van (the server answers
 * TRIP_VAN_NOT_EMPTY with `leftoversAllowed`, from Inc 2), this sheet gives way to "Finish with 2 on
 * the van?": a tap on Store closed or No one to scan is enough, and its English words are sent as the
 * reason, whatever the app language; only Other asks what happened. Without `leftoversAllowed` the
 * line says "The store must scan in 2 more from your van."
 */
export function FinishTripSheet({ visible, onClose, tripId, store }: FinishTripSheetProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<DriverStackParams>>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [leftovers, setLeftovers] = useState<number | null>(null);
  const pendingLeftovers = useRef<number | null>(null);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (swapTimer.current) clearTimeout(swapTimer.current);
    },
    [],
  );

  const finished = () => {
    refreshAfterFinish(queryClient, tripId);
    toast.show({ message: t('driver.trip.finished'), tone: 'success' });
    navigation.navigate('Home');
  };

  const finish = async () => {
    try {
      await finishTrip(tripId);
    } catch (thrown) {
      const error = toApiError(thrown);
      if (error.code === 'TRIP_VAN_NOT_EMPTY' && error.details.leftoversAllowed === true) {
        // This sheet closes; the leftovers sheet opens after it.
        pendingLeftovers.current = Math.max(1, Number(error.details.count) || 0);
        return;
      }
      throw error;
    }
    finished();
  };

  const finishWithLeftovers = async (input: ConfirmInput) => {
    const code = LEFTOVER_REASONS.find((reason) => reason === input.reasonCode);
    if (!code) return;
    const reason = code === 'OTHER' ? (input.note ?? '') : driverEnglish.trip.leftovers.reason[code];
    await finishTrip(tripId, reason);
    finished();
  };

  const reasons: ConfirmReason[] = LEFTOVER_REASONS.map((code: LeftoverReason) => ({
    code,
    label: t(`driver.trip.leftovers.reason.${code}`),
  }));

  return (
    <>
      <ConfirmSheet
        visible={visible}
        title={t('driver.trip.finishSheet.title')}
        body={t('driver.trip.finishSheet.body', { store })}
        confirmLabel={t('driver.trip.finishSheet.confirm')}
        confirmLoadingLabel={t('driver.trip.finishing')}
        cancelLabel={t('driver.trip.finishSheet.cancel')}
        onConfirm={finish}
        onClose={() => {
          onClose();
          const count = pendingLeftovers.current;
          pendingLeftovers.current = null;
          if (count !== null) swapTimer.current = setTimeout(() => setLeftovers(count), SHEET_SWAP_MS);
        }}
        testID="trip.finishSheet"
      />
      <ConfirmSheet
        visible={leftovers !== null}
        title={t('driver.trip.leftovers.title', { count: leftovers ?? 0 })}
        body={t('driver.trip.leftovers.body')}
        reasons={reasons}
        requireReason
        noteForOther
        noteLabel={t('driver.trip.leftovers.note')}
        noteMin={LEFTOVER_NOTE_MIN}
        confirmLabel={t('driver.trip.leftovers.confirm')}
        confirmLoadingLabel={t('driver.trip.finishing')}
        cancelLabel={t('driver.trip.finishSheet.cancel')}
        onConfirm={finishWithLeftovers}
        onClose={() => setLeftovers(null)}
        testID="trip.leftoversSheet"
      />
    </>
  );
}
