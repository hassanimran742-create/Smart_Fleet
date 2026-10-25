import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StoreIncomingDto } from '@smartfleet/shared-types';
import { isNetworkError, type ApiError } from '../../../api/errors';
import { POLL_MS, qk } from '../../../api/keys';
import { useAppConfig } from '../../../hooks/useAppConfig';
import { useFocusedInterval } from '../../../hooks/useFocusedInterval';
import { Button, CountBar, ErrorBanner, ltr, Screen, Skeleton, space, useNoConnection } from '../../../ui';
import { answerFromResult, ScanPanel, SizeLines, type ScanRead, type ScanReply } from '../../../ui/scan';
import { fetchStoreIncoming, sendStoreScan } from '../shared/api';
import { useShopNavigation, useShopRoute } from '../shared/navigation';
import { vanTitle } from './ReceiveListScreen';
import { afterReceive, sizeProgress, vanById, vanProgress, type IncomingVan } from './receiveModel';

/**
 * [Inc 2] S13 Receive from driver, the scan (UX_MOBILE §7.3; Inc 2/3 spec §2.3): scan each cylinder
 * off the van into the store, in the driver's step order, so both apps scan the same way: the van in the
 * header, the CountBar "1 of 2 received", the camera (RECEIVE) with its strip, the size lines with 2 or
 * more sizes, "Type number" while typed numbers are on, and the footer "Done", always enabled (leaving
 * never loses a saved scan; reads not yet saved ask first). A cylinder off another van says whose van.
 * The count is the server's: it moves only when a scan is saved. Polls `GET /store/incoming` every 15 s.
 */
export function ReceiveScanScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const noConnection = useNoConnection();
  const { config } = useAppConfig();
  const { params } = useShopRoute<'ReceiveScan'>();
  const vehicleId = params.vehicleId;
  const poll = useFocusedInterval(POLL_MS.storeIncoming);
  const incoming = useQuery<StoreIncomingDto, ApiError>({
    queryKey: qk.store.incoming,
    queryFn: fetchStoreIncoming,
    refetchInterval: poll,
  });

  // A van leaves the list once nothing is left on it: the screen keeps the last one it saw, complete.
  const current = vanById(incoming.data, vehicleId);
  const lastSeen = useRef<IncomingVan | null>(null);
  if (current) lastSeen.current = current;
  const gone = !!incoming.data && !current && lastSeen.current !== null;
  const van = current ?? lastSeen.current;
  const progress = van ? vanProgress(van) : null;
  const done = gone && progress ? progress.total : progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const refillOnly = progress?.refillOnly ?? false;

  const title = van ? vanTitle(van, t) : t('receive.title');
  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const plate = van?.vehicle.plateNo ?? null;
  const onScan = useCallback(
    async (read: ScanRead): Promise<ScanReply> => {
      const result = await sendStoreScan({ scanId: read.scanId, code: read.code, entryMethod: read.entryMethod });
      queryClient.setQueryData<StoreIncomingDto>(qk.store.incoming, (data) => (data ? afterReceive(data, result) : data));
      void queryClient.invalidateQueries({ queryKey: qk.store.incoming });
      // A refill completes on its last cylinder back (API_CONTRACT §10.1).
      void queryClient.invalidateQueries({ queryKey: ['refills'] });
      const from = result.fromVan;
      const otherVan = result.result === 'RECORDED' && from && plate !== null && from.plateNo !== plate && from.driver;
      const shortCode = result.cylinder.shortCode ?? result.cylinder.code;
      return answerFromResult(
        result,
        otherVan && from?.driver
          ? t('scan.recordedFrom', {
              shortCode: ltr(shortCode),
              size: result.cylinder.size.label,
              verb: t('scan.verb.RECEIVE'),
              driver: from.driver.name,
            })
          : undefined,
      );
    },
    [plate, queryClient, t],
  );

  const sizes = van ? sizeProgress(van) : [];
  const complete = van ? (gone ? true : progress?.complete) : undefined;
  const loading = !incoming.data && !incoming.isError && !noConnection;

  return (
    <Screen
      footer={<Button label={t('common.actions.done')} onPress={() => navigation.goBack()} size="lg" testID="receive.done" />}
    >
      <View style={styles.stack}>
        {/* No answer is the one "No connection" banner's to say; a server error shows here, above the camera. */}
        {incoming.isError && !incoming.data && !isNetworkError(incoming.error) ? (
          <ErrorBanner error={incoming.error} onRetry={() => void incoming.refetch()} />
        ) : null}
        {van && total > 0 ? (
          <CountBar
            count={done}
            total={total}
            verb={t('scan.verb.RECEIVE')}
            completeLabel={
              refillOnly
                ? t('scan.complete.REFILL_BACK', { count: total, total })
                : t('scan.complete.RECEIVE', { count: total, total })
            }
            testID="receive.count"
          />
        ) : loading ? (
          <Skeleton height={96} rounded={12} />
        ) : null}
        <ScanPanel
          step="RECEIVE"
          onScan={onScan}
          active={focused}
          complete={complete}
          allowTyped={config.features.typedCylinderNumber}
          testID="receive.scan"
        >
          {sizes.length >= 2 ? (
            <SizeLines
              lines={sizes.map((size) => ({
                key: size.key,
                text: t('scan.sizeProgress', { size: size.sizeLabel, done: gone ? size.total : size.done, total: size.total }),
                complete: gone || size.done >= size.total,
              }))}
            />
          ) : null}
        </ScanPanel>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
});
