import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import type { DriverStackParams } from '../../navigation/DriverStack';
import { Button, EmptyState } from '../../ui';
import { ScanPanel, type ScanOutcome, type ScanRead, type ScanStep } from '../../ui/scan';
import { DriverScreen } from './components';
import { fetchTrip, refreshAfterScan, scanCylinder, type LegacyScanEvent } from './tripApi';
import type { TripView } from './tripModel';

/** The step each legacy scan event serves (UX_MOBILE §0: Load, Deliver, Take back, Hand back). */
const STEP_OF: Record<LegacyScanEvent, ScanStep> = {
  SCAN_OUT: 'LOAD',
  DELIVERED: 'HANDOVER',
  PICKED_UP_EMPTY: 'TAKE_BACK',
  SCAN_IN: 'HAND_BACK',
};

type Nav = NativeStackNavigationProp<DriverStackParams, 'Scan'>;

/**
 * The scan screen for one trip step (UX_MOBILE §5). A step opens it with a fixed event, the trip and,
 * for a customer, the order; there is no list of scan types to choose from. Every scan goes to
 * `POST /custody/scan` and its result shows in the panel's strip.
 */
export function ScanScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<DriverStackParams, 'Scan'>>();
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const [cameraAllowed, setCameraAllowed] = useState(true);

  const tripId = params?.tripId ?? '';
  const orderId = params?.orderId;
  const eventType = params?.eventType;

  // The step's store or customer, from the trip the step screen already loaded.
  const trip = useQuery<TripView, ApiError>({
    queryKey: qk.trip(tripId),
    queryFn: () => fetchTrip(tripId),
    enabled: tripId !== '',
  });

  const onScan = useCallback(
    async (read: ScanRead): Promise<ScanOutcome> => {
      if (!eventType) throw new Error('scan step missing');
      const result = await scanCylinder({
        qrCode: read.code,
        eventType,
        tripId,
        orderId: eventType === 'DELIVERED' || eventType === 'PICKED_UP_EMPTY' ? orderId : undefined,
        lat: read.lat,
        lng: read.lng,
      });
      refreshAfterScan(queryClient, tripId);
      return result.alreadyRecorded ? 'already' : 'recorded';
    },
    [eventType, orderId, queryClient, tripId],
  );

  if (!eventType || tripId === '') {
    return (
      <DriverScreen
        footer={<Button label={t('driver.steps.backToTrip')} onPress={() => navigation.goBack()} />}
      >
        <EmptyState icon="scan" title={t('driver.steps.missing.title')} body={t('driver.steps.missing.body')} />
      </DriverScreen>
    );
  }

  const step = STEP_OF[eventType];
  const customer = (trip.data?.orders ?? []).find((order) => order.id === orderId)?.client?.name;
  const place =
    step === 'HANDOVER' || step === 'TAKE_BACK'
      ? customer ?? t('scan.theCustomer')
      : trip.data?.originStore?.name ?? t('scan.theStore');

  return (
    <DriverScreen
      footer={
        <Button
          label={t('scan.done')}
          variant={cameraAllowed ? 'primary' : 'secondary'}
          onPress={() => navigation.goBack()}
          testID="scan.done"
        />
      }
    >
      <ScanPanel
        step={step}
        place={place}
        onScan={onScan}
        active={focused}
        onCameraAllowedChange={setCameraAllowed}
        testID="scan.panel"
      />
    </DriverScreen>
  );
}
