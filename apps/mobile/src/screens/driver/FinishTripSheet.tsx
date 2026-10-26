import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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

/** The count a TRIP_VAN_NOT_EMPTY refusal offers to finish with, when the office allows it; else null. */
function leftoversOffered(error: unknown): number | null {
  const apiError = toApiError(error);
  if (apiError.code !== 'TRIP_VAN_NOT_EMPTY' || apiError.details.leftoversAllowed !== true) return null;
  return Math.max(1, Number(apiError.details.count) || 0);
}

export interface TripFinish {
  /** "Finish trip" with an empty van: asks "Finish this trip?" first (rule 7). */
  ask: () => void;
  /**
   * "Finish trip" pressed while cylinders are still on the van (Unload, R7): sent at once, so the
   * server's answer shows: "The store must scan in 2 more from your van." on the footer's line, or the
   * leftovers sheet when the office allows finishing with them.
   */
  now: () => void;
  /** The footer line's error from `now`. */
  error: unknown;
  /** Clears that line (the van changed, so its count is old). */
  clearError: () => void;
  pending: boolean;
  /** The two sheets; render them once in the screen. */
  sheets: ReactNode;
}

/**
 * "Finish trip" (driver spec D6 and R3; `POST /trips/:id/finish`). On success: Today, with the "Trip
 * done" toast. A refusal shows on the sheet's line ("Finish every stop first."), or on the footer's
 * line for `now`.
 *
 * When the office allows finishing with cylinders still on the van (TRIP_VAN_NOT_EMPTY with
 * `leftoversAllowed`), "Finish with 2 on the van?" opens: a tap on Store closed or No one to scan is
 * enough, and its English words are sent as the leftover reason, whatever the app language; only Other
 * asks what happened (5–300 characters).
 */
export function useTripFinish(tripId: string): TripFinish {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<DriverStackParams>>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [leftovers, setLeftovers] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const pendingLeftovers = useRef<number | null>(null);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (swapTimer.current) clearTimeout(swapTimer.current);
    };
  }, []);

  // Stable, so a screen can clear the line from an effect.
  const clearError = useCallback(() => setError(null), []);

  const finished = () => {
    refreshAfterFinish(queryClient, tripId);
    toast.show({ message: t('driver.trip.finished'), tone: 'success' });
    navigation.navigate('Home');
  };

  /** The confirm sheet's action: a leftovers offer closes it and opens the leftovers sheet after it. */
  const confirmFinish = async () => {
    try {
      await finishTrip(tripId);
    } catch (thrown) {
      const count = leftoversOffered(thrown);
      if (count !== null) {
        pendingLeftovers.current = count;
        return;
      }
      throw thrown;
    }
    finished();
  };

  const now = () => {
    if (pending) return;
    setPending(true);
    setError(null);
    finishTrip(tripId).then(
      () => {
        if (mounted.current) setPending(false);
        finished();
      },
      (thrown: unknown) => {
        if (!mounted.current) return;
        setPending(false);
        const count = leftoversOffered(thrown);
        if (count !== null) setLeftovers(count);
        else setError(thrown);
      },
    );
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

  const sheets = (
    <>
      <ConfirmSheet
        visible={asking}
        title={t('driver.trip.finishSheet.title')}
        body={t('driver.trip.finishSheet.bodyEmpty')}
        confirmLabel={t('driver.trip.finishSheet.confirm')}
        confirmLoadingLabel={t('driver.trip.finishing')}
        cancelLabel={t('driver.trip.finishSheet.cancel')}
        onConfirm={confirmFinish}
        onClose={() => {
          setAsking(false);
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

  return {
    ask: () => {
      setError(null);
      setAsking(true);
    },
    now,
    error,
    clearError,
    pending,
    sheets,
  };
}
